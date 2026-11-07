// Catalogue PDFs.
//   Guests and accounts awaiting approval get the public 2-page preview (catalogues/*-preview.pdf).
//   Approved retailers get the full PDF, which is kept encrypted (netlify/private/*.enc) and
//   unlocked with the env var CATALOGUE_KEY.
//
//   POST /api/catalogue { name }  (Authorization: Bearer <login token>)
//        -> { url }  a link to the full PDF that works for 10 minutes, or { preview } for guests
//   GET  /api/catalogue?f=<name>&e=<expiry>&s=<signature>  -> the full PDF
//
// Works on Cloudflare Pages (reads the encrypted file through env.ASSETS) and on Netlify.

import { createHmac, createHash, timingSafeEqual } from "node:crypto";
import { viewerFrom, accountsReady } from "../lib/auth.mjs";

const CATALOGUES = {
  "drop-earrings": { file: "/netlify/private/drop-earrings.enc", title: "Sardar Gems - Drop Earrings.pdf", preview: "/catalogues/sardar-gems-drop-earrings-preview.pdf" }
};
const LINK_MINUTES = 10;
const out = (data, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
const linkSecret = () => createHash("sha256").update("sjh-catalogue|" + (process.env.SESSION_SECRET || process.env.SUPABASE_SERVICE_KEY || "")).digest();
const sign = (f, e) => createHmac("sha256", linkSecret()).update(`${f}|${e}`).digest("base64url");
const cache = {};

async function decrypt(req, ctx, path) {
  if (cache[path]) return cache[path];
  const raw = Buffer.from(process.env.CATALOGUE_KEY || "", "base64");
  if (raw.length !== 32) throw new Error("CATALOGUE_KEY not set");
  const url = new URL(path, req.url);
  const res = ctx && ctx.env && ctx.env.ASSETS ? await ctx.env.ASSETS.fetch(url) : await fetch(url);
  if (!res.ok) throw new Error("Catalogue file missing");
  const buf = new Uint8Array(await res.arrayBuffer());
  const iv = buf.slice(0, 12), tag = buf.slice(12, 28), body = buf.slice(28);
  const sealed = new Uint8Array(body.length + 16); sealed.set(body); sealed.set(tag, body.length);   // WebCrypto wants ciphertext+tag
  const key = await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["decrypt"]);
  return (cache[path] = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, sealed));
}

export default async (req, ctx) => {
  const url = new URL(req.url);

  if (req.method === "POST") {
    let body = {}; try { body = await req.json(); } catch {}
    const cat = CATALOGUES[body.name];
    if (!cat) return out({ error: "Unknown catalogue" }, 404);
    const viewer = await viewerFrom(req);
    const full = accountsReady() && viewer && viewer.status === "approved";
    if (!full) return out({ preview: cat.preview, reason: viewer ? "pending" : "guest" });
    if (!process.env.CATALOGUE_KEY) return out({ preview: cat.preview, reason: "not-ready" });
    const e = Date.now() + LINK_MINUTES * 60e3;
    return out({ url: `/api/catalogue?f=${encodeURIComponent(body.name)}&e=${e}&s=${sign(body.name, e)}` });
  }

  const f = url.searchParams.get("f") || "", e = Number(url.searchParams.get("e") || 0), s = url.searchParams.get("s") || "";
  const cat = CATALOGUES[f];
  const want = sign(f, e);
  const valid = cat && e > Date.now() && s.length === want.length && timingSafeEqual(Buffer.from(s), Buffer.from(want));
  if (!valid) return Response.redirect(new URL((cat && cat.preview) || "/#catalogues", url.origin), 302);
  try {
    const pdf = await decrypt(req, ctx, cat.file);
    return new Response(pdf, { headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${cat.title}"`,
      "Cache-Control": "private, no-store",
      "X-Robots-Tag": "noindex"
    } });
  } catch (err) {
    console.warn("catalogue", err.message);
    return Response.redirect(new URL(cat.preview, url.origin), 302);
  }
};

export const config = { path: "/api/catalogue" };
