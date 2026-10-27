// Admin actions for the upload page. Every request must carry the admin password (header x-admin-password).
//   { action:"check" }                                           -> verifies password
//   { action:"list" }                                            -> all product uploads
//   { action:"sign", cat, code, purity:[...] }                   -> signature for a direct upload to Cloudinary
//   { action:"delete", publicId, resourceType }                  -> deletes an upload
//   { action:"rename", publicId, resourceType, code, purity }    -> changes code / purity
//   { action:"customers" }                                       -> all retailer accounts
//   { action:"set-status", id, status }                          -> approve / reject / block / pending
//   { action:"reset-password", id, password }                    -> sets a new password for a retailer
// Needs Netlify env vars: ADMIN_PASSWORD, CLOUDINARY_*, SUPABASE_SERVICE_KEY (for customers)

import { createHash, timingSafeEqual } from "node:crypto";
import { TAG, cloudEnv, signParams, listProducts } from "../lib/cloud.mjs";
import { db, accountsReady, hashPassword } from "../lib/auth.mjs";
import { PURITIES } from "../lib/catalog.mjs";

const SLUG = /^[a-z0-9-]{1,40}$/;
const purityOf = arr => (Array.isArray(arr) ? arr : []).map(x => String(x).toUpperCase()).filter(x => PURITIES.includes(x)).filter((x, i, a) => a.indexOf(x) === i).join(",");
const clean = s => String(s || "").replace(/[|=\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
const sha1 = s => createHash("sha1").update(s).digest("hex");
const out = (d, status = 200) => Response.json(d, { status, headers: { "Cache-Control": "no-store" } });

function passwordOk(given) {
  const real = process.env.ADMIN_PASSWORD || "";
  if (!real || !given) return false;
  return timingSafeEqual(Buffer.from(sha1(given)), Buffer.from(sha1(real)));
}

export default async (req) => {
  if (req.method !== "POST") return out({ error: "POST only" }, 405);
  const env = cloudEnv();
  if (!env || !process.env.ADMIN_PASSWORD)
    return out({ error: "Server not configured (Cloudinary keys / ADMIN_PASSWORD missing in Netlify)" }, 500);
  if (!passwordOk(req.headers.get("x-admin-password"))) {
    await new Promise(r => setTimeout(r, 800));
    return out({ error: "Wrong password" }, 401);
  }
  let body = {}; try { body = await req.json(); } catch {}
  const timestamp = Math.floor(Date.now() / 1000);

  switch (body.action) {
    case "check": return out({ ok: true, cloud: env.cloud, accounts: accountsReady() });

    case "list": return out({ items: await listProducts() });

    case "sign": {
      const cat = String(body.cat || "");
      if (!SLUG.test(cat)) return out({ error: "Bad category" }, 400);
      const params = { context: `code=${clean(body.code)}|cat=${cat}|purity=${purityOf(body.purity)}`, folder: `sardar/${cat}`, tags: TAG, timestamp };
      return out({ cloud: env.cloud, apiKey: env.key, ...params, signature: signParams(params, env.secret) });
    }

    case "delete":
    case "rename": {
      const publicId = String(body.publicId || "");
      const type = body.resourceType === "video" ? "video" : "image";
      if (!publicId.startsWith("sardar/")) return out({ error: "Not allowed" }, 400);
      let endpoint, params;
      if (body.action === "delete") { endpoint = "destroy"; params = { invalidate: "true", public_id: publicId, timestamp }; }
      else {
        endpoint = "explicit";
        const cat = publicId.split("/")[1] || "";
        params = { context: `code=${clean(body.code)}|cat=${cat}|purity=${purityOf(body.purity)}`, public_id: publicId, type: "upload", timestamp };
      }
      const form = new URLSearchParams({ ...params, api_key: env.key, signature: signParams(params, env.secret) });
      const res = await fetch(`https://api.cloudinary.com/v1_1/${env.cloud}/${type}/${endpoint}`, { method: "POST", body: form });
      const j = await res.json();
      if (!res.ok || j.error) return out({ error: j.error?.message || "Cloudinary error" }, 502);
      return out({ ok: true, result: j.result || "ok" });
    }

    case "customers": {
      if (!accountsReady()) return out({ error: "Customer accounts not set up (SUPABASE_SERVICE_KEY missing in Netlify)" }, 500);
      const rows = await db("customers?select=id,phone,name,shop,city,state,gstin,card_url,status,approval,created_at,approved_at,last_login,login_count&order=created_at.desc&limit=1000");
      return out({ customers: rows });
    }

    case "set-status": {
      const status = String(body.status || "");
      if (!["approved", "pending", "rejected", "blocked"].includes(status)) return out({ error: "Bad status" }, 400);
      const id = String(body.id || "");
      const cur = await db(`customers?id=eq.${encodeURIComponent(id)}&select=session_version`);
      if (!cur.length) return out({ error: "Not found" }, 404);
      const patch = { status, approval: status === "approved" ? "manual-approved" : undefined };
      if (status === "approved") patch.approved_at = new Date().toISOString();
      if (status === "rejected" || status === "blocked") patch.session_version = cur[0].session_version + 1;   // logs them out
      const rows = await db(`customers?id=eq.${encodeURIComponent(id)}`, { method: "PATCH", body: patch, prefer: "return=representation" });
      return out({ ok: true, customer: rows[0] && { id: rows[0].id, status: rows[0].status } });
    }

    case "reset-password": {
      const pw = String(body.password || "");
      if (pw.length < 6) return out({ error: "Password must be at least 6 characters" }, 400);
      const id = String(body.id || "");
      const cur = await db(`customers?id=eq.${encodeURIComponent(id)}&select=session_version`);
      if (!cur.length) return out({ error: "Not found" }, 404);
      await db(`customers?id=eq.${encodeURIComponent(id)}`, { method: "PATCH", body: { pass_hash: hashPassword(pw), session_version: cur[0].session_version + 1 } });
      return out({ ok: true });
    }
  }
  return out({ error: "Unknown action" }, 400);
};

export const config = { path: "/api/admin" };
