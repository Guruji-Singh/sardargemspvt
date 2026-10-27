// Admin actions for the upload page. Every request must carry the admin password.
//   POST /api/admin  { action: "check" }                                  -> verifies password
//   POST /api/admin  { action: "sign", cat, code, purity:[...] }          -> signature for a direct upload to Cloudinary
//   POST /api/admin  { action: "delete", publicId, resourceType }         -> deletes an upload
//   POST /api/admin  { action: "rename", publicId, resourceType, code, purity:[...] } -> changes code / purity
// Needs Netlify env vars: ADMIN_PASSWORD, CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET

import { createHash, timingSafeEqual } from "node:crypto";

const TAG = "sardar";
const SLUG = /^[a-z0-9-]{1,40}$/;
const PURITIES = ["14K", "16K", "18K", "20K", "22K"];
const purityOf = arr => (Array.isArray(arr) ? arr : []).map(x => String(x).toUpperCase()).filter(x => PURITIES.includes(x)).filter((x, i, a) => a.indexOf(x) === i).join(",");

const sha1 = s => createHash("sha1").update(s).digest("hex");
const sign = (params, secret) =>
  sha1(Object.keys(params).sort().map(k => `${k}=${params[k]}`).join("&") + secret);
const clean = s => String(s || "").replace(/[|=\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);

function passwordOk(given) {
  const real = process.env.ADMIN_PASSWORD || "";
  if (!real || !given) return false;
  const a = Buffer.from(sha1(given)), b = Buffer.from(sha1(real));
  return timingSafeEqual(a, b);
}

export default async (req) => {
  if (req.method !== "POST") return Response.json({ error: "POST only" }, { status: 405 });
  const { CLOUDINARY_CLOUD_NAME: cloud, CLOUDINARY_API_KEY: key, CLOUDINARY_API_SECRET: secret } = process.env;
  if (!cloud || !key || !secret || !process.env.ADMIN_PASSWORD)
    return Response.json({ error: "Server not configured (Cloudinary keys / ADMIN_PASSWORD missing in Netlify)" }, { status: 500 });

  if (!passwordOk(req.headers.get("x-admin-password"))) {
    await new Promise(r => setTimeout(r, 800)); // slow down guessing
    return Response.json({ error: "Wrong password" }, { status: 401 });
  }

  let body = {};
  try { body = await req.json(); } catch {}
  const timestamp = Math.floor(Date.now() / 1000);

  if (body.action === "check") return Response.json({ ok: true, cloud });

  if (body.action === "sign") {
    const cat = String(body.cat || "");
    if (!SLUG.test(cat)) return Response.json({ error: "Bad category" }, { status: 400 });
    const params = {
      context: `code=${clean(body.code)}|cat=${cat}|purity=${purityOf(body.purity)}`,
      folder: `sardar/${cat}`,
      tags: TAG,
      timestamp
    };
    return Response.json({ cloud, apiKey: key, ...params, signature: sign(params, secret) });
  }

  if (body.action === "delete" || body.action === "rename") {
    const publicId = String(body.publicId || "");
    const type = body.resourceType === "video" ? "video" : "image";
    if (!publicId.startsWith("sardar/")) return Response.json({ error: "Not allowed" }, { status: 400 });

    let endpoint, params;
    if (body.action === "delete") {
      endpoint = "destroy";
      params = { invalidate: "true", public_id: publicId, timestamp };
    } else {
      endpoint = "explicit";
      const cat = publicId.split("/")[1] || "";
      params = { context: `code=${clean(body.code)}|cat=${cat}|purity=${purityOf(body.purity)}`, public_id: publicId, type: "upload", timestamp };
    }
    const form = new URLSearchParams({ ...params, api_key: key, signature: sign(params, secret) });
    const res = await fetch(`https://api.cloudinary.com/v1_1/${cloud}/${type}/${endpoint}`, { method: "POST", body: form });
    const j = await res.json();
    if (!res.ok || j.error) return Response.json({ error: j.error?.message || "Cloudinary error" }, { status: 502 });
    return Response.json({ ok: true, result: j.result || "ok" });
  }

  return Response.json({ error: "Unknown action" }, { status: 400 });
};

export const config = { path: "/api/admin" };
