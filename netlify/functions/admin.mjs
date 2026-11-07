// Admin actions for the upload page.
//   { action:"login" }  with header x-admin-password             -> returns a login token (valid 12 hours)
//   Every other request must carry that token (header x-admin-token).
//   { action:"check" }                                           -> verifies the token
//   { action:"list" }                                            -> all product uploads
//   { action:"sign", cat, code, purity:[...] }                   -> signature for a direct upload to Cloudinary
//   { action:"delete", publicId, resourceType }                  -> deletes an upload
//   { action:"rename", publicId, resourceType, code, purity }    -> changes code / purity
//   { action:"customers" }                                       -> all retailer accounts
//   { action:"set-status", id, status }                          -> approve / reject / block / pending
//   { action:"reset-password", id, password }                    -> sets a new password for a retailer
//   Catalogues (see netlify/lib/catalogues.mjs):
//   { action:"cat-list" } / { action:"cat-tiles", slug }          -> catalogues / one catalogue's designs
//   { action:"cat-sign", kind:"supplier"|"tile"|"branded"|"preview", slug, ... } -> signature for a direct upload
//   { action:"cat-save", slug, name?, status?, count?, branded?, preview? }       -> updates a catalogue
//   { action:"tile-save", publicId, cat, code, orig, page, n } / { action:"tile-delete", publicId }
//   { action:"cat-delete", slug }                                -> deletes a catalogue and all its files
//   { action:"cat-download", slug, which:"supplier"|"branded"|"preview" } -> 10-minute download link
//   { action:"lookup", codes:[...] }                              -> which catalogue / supplier code each code is
// Needs Netlify env vars: ADMIN_PASSWORD, CLOUDINARY_*, SUPABASE_SERVICE_KEY (for customers)

import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { TAG, cloudEnv, signParams, listProducts } from "../lib/cloud.mjs";
import { db, accountsReady, hashPassword } from "../lib/auth.mjs";
import { PURITIES } from "../lib/catalog.mjs";
import { RULES, clientIp, lockedFor, recordFail, clearFails, lockedMsg } from "../lib/limit.mjs";
import { TAGS, SLUG as CAT_SLUG, cleanCtx, listCatalogues, getCatalogue, listTiles, findCodes, downloadUrl, signUpload, setContext, destroy, deleteCatalogue, catalogueContext } from "../lib/catalogues.mjs";

const rand = () => crypto.randomUUID().replace(/-/g, "").slice(0, 8);
const tileContext = t => `cat=${t.cat}|code=${cleanCtx(t.code)}|orig=${cleanCtx(t.orig)}|page=${Number(t.page) || 0}|n=${Number(t.n) || 0}`;

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

/* Admin login token: signed, expires in 12 hours. Changing ADMIN_PASSWORD in Netlify logs everyone out. */
const TOKEN_HOURS = 12;
const tokenKey = () => createHash("sha256").update("sjh-admin|" + (process.env.ADMIN_PASSWORD || "") + "|" + (process.env.SESSION_SECRET || process.env.SUPABASE_SERVICE_KEY || "")).digest();
function makeAdminToken() {
  const payload = Buffer.from(JSON.stringify({ a: 1, exp: Date.now() + TOKEN_HOURS * 3600e3 })).toString("base64url");
  return `${payload}.${createHmac("sha256", tokenKey()).update(payload).digest("base64url")}`;
}
function tokenOk(token) {
  if (!token || !token.includes(".")) return false;
  const [payload, sig] = token.split(".");
  const want = createHmac("sha256", tokenKey()).update(payload).digest("base64url");
  if (sig.length !== want.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return false;
  try { return JSON.parse(Buffer.from(payload, "base64url").toString()).exp > Date.now(); } catch { return false; }
}

export default async (req) => {
  if (req.method !== "POST") return out({ error: "POST only" }, 405);
  const env = cloudEnv();
  if (!env || !process.env.ADMIN_PASSWORD)
    return out({ error: "Server not configured (Cloudinary keys / ADMIN_PASSWORD missing in the hosting settings)" }, 500);
  let body = {}; try { body = await req.json(); } catch {}

  if (body.action === "login") {
    const ip = "admin-ip:" + clientIp(req);
    const mins = await lockedFor([ip, "admin-all"]);
    if (mins) return out({ error: lockedMsg(mins) }, 429);
    if (!passwordOk(req.headers.get("x-admin-password"))) {
      await recordFail([[ip, RULES.adminIp], ["admin-all", RULES.adminAll]]);
      await new Promise(r => setTimeout(r, 800));
      return out({ error: "Wrong password" }, 401);
    }
    await clearFails([ip]);
    return out({ token: makeAdminToken(), hours: TOKEN_HOURS });
  }

  if (!tokenOk(req.headers.get("x-admin-token"))) return out({ error: "Please log in again" }, 401);
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

    case "cat-list": return out({ catalogues: await listCatalogues() });

    case "cat-tiles": return out({ tiles: await listTiles(await getCatalogue(String(body.slug || ""))) });

    case "cat-sign": {
      const slug = String(body.slug || "");
      if (!CAT_SLUG.test(slug)) return out({ error: "Bad catalogue name" }, 400);
      const kind = String(body.kind || "");
      if (kind === "supplier") {
        if (await getCatalogue(slug)) return out({ error: "A catalogue with this name already exists" }, 409);
        const dir = `${slug}-${rand()}`;
        const meta = { name: body.name, slug, dir, prefix: body.prefix, sprefix: body.sprefix, status: "draft", count: body.count };
        return out({ dir, ...signUpload({ resourceType: "raw", authenticated: true, publicId: `catalogues/${dir}/supplier-${rand()}.dat`, tags: TAGS.cat, context: catalogueContext(meta) }) });
      }
      const dir = String(body.dir || "");
      if (!dir.startsWith(slug + "-") || !/^[a-z0-9-]{3,60}$/.test(dir)) return out({ error: "Bad catalogue folder" }, 400);
      if (kind === "tile") {
        const n = Number(body.n) || 0;
        const t = { cat: slug, code: body.code, orig: body.orig, page: body.page, n };
        return out(signUpload({ resourceType: "image", publicId: `catalogues/${dir}/${String(n).padStart(3, "0")}-${rand()}`, tags: TAGS.tile, context: tileContext(t) }));
      }
      if (kind === "branded" || kind === "preview")
        return out(signUpload({ resourceType: "raw", authenticated: true, publicId: `catalogues/${dir}/${kind}-${rand()}.dat`, tags: TAGS.pdf, context: `cat=${slug}|kind=${kind}` }));
      return out({ error: "Bad kind" }, 400);
    }

    case "cat-save": {
      const cat = await getCatalogue(String(body.slug || ""));
      if (!cat) return out({ error: "Catalogue not found" }, 404);
      const next = { ...cat };
      for (const k of ["name", "status", "count", "branded", "preview"]) if (body[k] !== undefined) next[k] = body[k];
      for (const k of ["branded", "preview"]) if (next[k] && !String(next[k]).startsWith(`catalogues/${cat.dir}/`)) return out({ error: "Bad file" }, 400);
      await setContext({ resourceType: "raw", type: "authenticated", publicId: cat.supplier, context: catalogueContext(next) });
      return out({ ok: true, catalogue: next });
    }

    case "tile-save":
    case "tile-delete": {
      const publicId = String(body.publicId || "");
      const dir = publicId.split("/")[1] || "";
      if (!publicId.startsWith("catalogues/") || !/^[a-z0-9-]{1,60}$/.test(dir)) return out({ error: "Not allowed" }, 400);
      const cat = String(body.cat || dir);
      if (body.action === "tile-delete") await destroy({ resourceType: "image", type: "upload", publicId });
      else await setContext({ resourceType: "image", type: "upload", publicId, context: tileContext({ ...body, cat }) });
      return out({ ok: true });
    }

    case "cat-delete": {
      const cat = await getCatalogue(String(body.slug || ""));
      if (!cat) return out({ error: "Catalogue not found" }, 404);
      await deleteCatalogue(cat);
      return out({ ok: true });
    }

    case "cat-download": {
      const cat = await getCatalogue(String(body.slug || ""));
      if (!cat) return out({ error: "Catalogue not found" }, 404);
      const id = { supplier: cat.supplier, branded: cat.branded, preview: cat.preview }[body.which];
      if (!id) return out({ error: "That file is not there" }, 404);
      return out({ url: downloadUrl(id, 10) });
    }

    case "lookup": {
      const codes = (Array.isArray(body.codes) ? body.codes : []).map(String);
      const [tiles, cats] = await Promise.all([findCodes(codes), listCatalogues()]);
      const bySlug = Object.fromEntries(cats.map(c => [c.slug, c]));
      return out({ found: tiles.map(t => ({ ...t, catalogue: bySlug[t.cat] ? { slug: t.cat, name: bySlug[t.cat].name, sprefix: bySlug[t.cat].sprefix } : null })) });
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
