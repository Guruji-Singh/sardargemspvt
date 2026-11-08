// Catalogues made from supplier PDFs (admin page → Catalogues tab).
//
// Where things are kept:
//   Supabase table catalogues        one row per catalogue: name, slug, dir, prefixes, status, count and where its
//                                    PDFs are (supplier / branded / preview)
//   Supabase table catalogue_tiles   one row per design: Cloudinary public_id, our code, supplier code, page, number
//   Cloudinary  catalogues/<dir>/<nn>-<rand>   the design pictures (fast, resized on the fly)
//   Hostinger   sjh-website/store/catalogues/<dir>/*.pdf   the PDFs (private; reached with signed links to files.php)
// A PDF location is "host:catalogues/<dir>/<name>.pdf" (Hostinger) or a Cloudinary raw public_id (older catalogues).
// dir = slug + random part, so a deleted catalogue's clean-up can never touch a new one with the same name.

import { cloudEnv, signParams } from "./cloud.mjs";
import { db, accountsReady } from "./auth.mjs";
import { createHmac, createHash, timingSafeEqual } from "node:crypto";

/* Signed, short-lived links to our own /api/catalogue for stored PDFs (served as real .pdf files). */
const fileSecret = () => createHash("sha256").update("sjh-file|" + (process.env.SESSION_SECRET || process.env.SUPABASE_SERVICE_KEY || "")).digest();
const fileSig = (id, name, e) => createHmac("sha256", fileSecret()).update(`${id}|${name}|${e}`).digest("base64url");
export function pdfLink(publicId, filename, minutes = 10) {
  const e = Date.now() + minutes * 60e3;
  return `/api/catalogue?file=${encodeURIComponent(publicId)}&name=${encodeURIComponent(filename)}&e=${e}&s=${fileSig(publicId, filename, e)}`;
}
export function checkPdfLink(params) {
  const id = params.get("file") || "", name = params.get("name") || "", e = Number(params.get("e") || 0), s = params.get("s") || "";
  if (!id.startsWith("catalogues/") || !(e > Date.now())) return null;
  const want = fileSig(id, name, e);
  return s.length === want.length && timingSafeEqual(Buffer.from(s), Buffer.from(want)) ? { id, name } : null;
}

/* ---------- Hostinger PDF storage (sjh-website/files.php) ---------- */
export const isHost = ref => String(ref || "").startsWith("host:");
const hostPath = ref => String(ref).slice(5);
export function hostConfigured() { return !!(process.env.STOCK_API_URL && process.env.STOCK_API_KEY); }
function hostUrl(payload, minutes = 15) {
  if (!hostConfigured()) throw new Error("PDF storage not set up (STOCK_API_URL / STOCK_API_KEY)");
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + minutes * 60 })).toString("base64url");
  const sig = createHmac("sha256", process.env.STOCK_API_KEY).update(body).digest("base64url");
  return new URL(`files.php?t=${body}.${sig}`, process.env.STOCK_API_URL).href;
}
/** Where the admin page uploads a PDF to (POST, multipart field "file"). */
export function hostPutUrl(dir, name) {
  const path = `catalogues/${dir}/${name}.pdf`;
  return { url: hostUrl({ act: "put", path }, 60), ref: `host:${path}` };
}
/** Link that opens (or downloads) a stored PDF, wherever it is kept. Relative for Cloudinary, absolute for Hostinger. */
export function pdfUrl(ref, filename, { download = false, minutes = 10 } = {}) {
  if (!ref) return "";
  if (isHost(ref)) return hostUrl({ act: "get", path: hostPath(ref), name: filename, dl: download ? 1 : 0 }, minutes);
  return pdfLink(ref, filename, minutes);
}
async function hostDeleteDir(dir) {
  const r = await fetch(hostUrl({ act: "del", path: `catalogues/${dir}/` }, 5), { method: "POST" });
  if (!r.ok) throw new Error(`PDF storage ${r.status}`);
}

export const TAGS = { cat: "sjh-catalogue", pdf: "sjh-catalogue-pdf", tile: "sjh-tile" };
export const SLUG = /^[a-z0-9][a-z0-9-]{0,39}$/;
export const cleanCtx = s => String(s ?? "").replace(/[|=\\"]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
const ctxOf = r => (r.context && (r.context.custom || r.context)) || {};
const auth = env => ({ Authorization: "Basic " + btoa(`${env.key}:${env.secret}`) });

export async function search(expression, { max = 500, sort = [{ public_id: "asc" }] } = {}) {
  const env = cloudEnv();
  if (!env) throw new Error("Cloudinary not configured");
  const all = [];
  let cursor;
  for (let i = 0; i < 6; i++) {
    const r = await fetch(`https://api.cloudinary.com/v1_1/${env.cloud}/resources/search`, {
      method: "POST", headers: { "Content-Type": "application/json", ...auth(env) },
      body: JSON.stringify({ expression, with_field: ["context", "tags"], sort_by: sort, max_results: Math.min(max, 500), ...(cursor ? { next_cursor: cursor } : {}) })
    });
    const j = await r.json();
    if (!r.ok || j.error) throw new Error(j.error?.message || `Cloudinary ${r.status}`);
    all.push(...(j.resources || []));
    if (!(cursor = j.next_cursor) || all.length >= max) break;
  }
  return all;
}

export function catalogueFromResource(r) {
  const c = ctxOf(r);
  return {
    slug: c.slug, dir: c.dir || c.slug, name: c.name || c.slug, prefix: c.prefix || "", sprefix: c.sprefix || "",
    status: c.status === "published" ? "published" : "draft", count: Number(c.count || 0),
    supplier: r.public_id, branded: c.branded || "", preview: c.preview || "",
    bytes: r.bytes || 0, created: r.created_at
  };
}

export function tileFromResource(r, cloud) {
  const c = ctxOf(r), base = `https://res.cloudinary.com/${cloud}/image/upload`;
  return {
    publicId: r.public_id, cat: c.cat || "", code: c.code || "", orig: c.orig || "", page: Number(c.page || 0), n: Number(c.n || 0),
    src: `${base}/f_auto,q_auto,w_1000,c_limit/${r.public_id}`,
    thumb: `${base}/f_auto,q_auto,w_480,c_limit/${r.public_id}`
  };
}

/** Lists stored files by public_id prefix (Admin API: up to date at once, unlike search). */
async function listByPrefix(path, prefix) {
  const env = cloudEnv();
  if (!env) throw new Error("Cloudinary not configured");
  const all = [];
  let cursor = "";
  for (let i = 0; i < 6; i++) {
    const r = await fetch(`https://api.cloudinary.com/v1_1/${env.cloud}/resources/${path}?prefix=${encodeURIComponent(prefix)}&context=true&tags=true&max_results=500${cursor ? "&next_cursor=" + cursor : ""}`, { headers: auth(env) });
    const j = await r.json();
    if (!r.ok || j.error) throw new Error(j.error?.message || `Cloudinary ${r.status}`);
    all.push(...(j.resources || []));
    if (!(cursor = j.next_cursor)) break;
  }
  return all;
}

const CAT_COLS = "slug,dir,name,prefix,sprefix,status,count,supplier,branded,preview,created_at";
const rowToCat = r => ({ ...r, count: Number(r.count || 0), status: r.status === "published" ? "published" : "draft", created: r.created_at });
let legacyChecked = 0;

/** Catalogues made before the database table existed live only in Cloudinary; copy them into the table once. */
async function importLegacy(have) {
  if (Date.now() - legacyChecked < 10 * 60e3 || !cloudEnv()) return [];
  legacyChecked = Date.now();
  const old = (await listByPrefix("raw/authenticated", "catalogues/"))
    .filter(r => (r.tags || []).includes(TAGS.cat)).map(catalogueFromResource)
    .filter(c => c.slug && SLUG.test(c.slug) && !have.has(c.slug));
  if (!old.length) return [];
  const rows = old.map(c => ({ slug: c.slug, dir: c.dir, name: c.name, prefix: c.prefix, sprefix: c.sprefix, status: c.status,
    count: c.count, supplier: c.supplier, branded: c.branded, preview: c.preview, created_at: c.created }));
  await db("catalogues?on_conflict=slug", { method: "POST", body: rows, prefer: "resolution=ignore-duplicates,return=minimal" });
  return rows.map(rowToCat);
}

export async function listCatalogues() {
  if (!accountsReady()) throw new Error("Database not configured");
  let cats = (await db(`catalogues?select=${CAT_COLS}&order=created_at.desc`)).map(rowToCat);
  try { cats = cats.concat(await importLegacy(new Set(cats.map(c => c.slug)))); } catch (e) { console.warn("legacy catalogues", e.message); }
  return cats;
}

export async function getCatalogue(slug) {
  if (!SLUG.test(String(slug || ""))) return null;
  const rows = await db(`catalogues?select=${CAT_COLS}&slug=eq.${encodeURIComponent(slug)}`);
  if (rows.length) return rowToCat(rows[0]);
  return (await listCatalogues()).find(c => c.slug === slug) || null;
}

export async function createCatalogue(c) {
  await db("catalogues", { method: "POST", body: [c], prefer: "return=minimal" });
}

export async function updateCatalogue(slug, fields) {
  await db(`catalogues?slug=eq.${encodeURIComponent(slug)}`, { method: "PATCH", body: fields, prefer: "return=minimal" });
}

/* The list of designs is kept in the database (table catalogue_tiles), written by the admin page right after
   each upload. Reading it is instant and doesn't use Cloudinary's API, which on the free plan is limited per hour
   and whose search can lag behind new uploads. Designs not yet in the table (older catalogues) are picked up from
   Cloudinary at most every 5 minutes per catalogue and saved to the table. */
const rowToTile = (r, cloud) => {
  const base = `https://res.cloudinary.com/${cloud}/image/upload`;
  return { publicId: r.public_id, cat: r.cat, code: r.code, orig: r.orig, page: r.page, n: r.n,
           src: `${base}/f_auto,q_auto,w_1000,c_limit/${r.public_id}`, thumb: `${base}/f_auto,q_auto,w_480,c_limit/${r.public_id}` };
};
const lastSync = {};

export async function saveTileRows(rows) {
  if (!rows.length || !accountsReady()) return;
  await db("catalogue_tiles?on_conflict=public_id", { method: "POST", body: rows, prefer: "resolution=merge-duplicates,return=minimal" });
}

async function cloudinaryTiles(cat) {
  const isTile = r => !r.tags || r.tags.includes(TAGS.tile);
  const [a, b] = await Promise.allSettled([
    listByPrefix("image/upload", `catalogues/${cat.dir}/`).then(rows => rows.filter(isTile)),
    search(`resource_type:image AND tags=${TAGS.tile} AND context.cat="${cat.slug}"`)
  ]);
  const byId = new Map();
  [...(b.status === "fulfilled" ? b.value : []), ...(a.status === "fulfilled" ? a.value : [])].forEach(r => byId.set(r.public_id, r));
  if (!byId.size && a.status === "rejected") throw a.reason;
  return [...byId.values()].map(r => { const c = ctxOf(r); return { public_id: r.public_id, cat: cat.slug, code: c.code || "", orig: c.orig || "", page: Number(c.page || 0), n: Number(c.n || 0) }; });
}

/** Designs of one catalogue (pass the catalogue from listCatalogues/getCatalogue). */
export async function listTiles(cat, { sync = false } = {}) {
  const env = cloudEnv();
  if (!cat || !cat.dir) return [];
  const mine = r => r.public_id.startsWith(`catalogues/${cat.dir}/`);
  let rows = [];
  if (accountsReady()) {
    try { rows = (await db(`catalogue_tiles?cat=eq.${encodeURIComponent(cat.slug)}&select=*&order=n.asc&limit=2000`)).filter(mine); }
    catch (e) { console.warn("catalogue_tiles", e.message); }
  }
  const due = sync || !lastSync[cat.dir] || Date.now() - lastSync[cat.dir] > 5 * 60e3;
  if ((rows.length < (cat.count || 1) || !accountsReady()) && due) {
    lastSync[cat.dir] = Date.now();
    try {
      const found = (await cloudinaryTiles(cat)).filter(mine);
      const have = new Set(rows.map(r => r.public_id)), add = found.filter(r => !have.has(r.public_id));
      if (add.length) { rows = rows.concat(add); saveTileRows(add).catch(e => console.warn("save tiles", e.message)); }
    } catch (e) { if (!rows.length) throw e; }
  }
  return rows.map(r => rowToTile(r, env.cloud)).sort((x, y) => (x.n - y.n) || x.publicId.localeCompare(y.publicId));
}

/** Tiles whose code is in `codes` (up to 60 at a time). */
export async function findCodes(codes) {
  const env = cloudEnv();
  const list = [...new Set(codes.map(c => cleanCtx(c).toUpperCase()).filter(Boolean))].slice(0, 60);
  if (!list.length) return [];
  let rows = [];
  if (accountsReady()) {
    try { rows = await db(`catalogue_tiles?select=*&code=in.(${list.map(c => `"${c.replace(/"/g, "")}"`).join(",")})`); }
    catch (e) { console.warn("findCodes", e.message); }
  }
  const missing = list.filter(c => !rows.some(r => r.code.toUpperCase() === c));
  if (missing.length) {
    try {
      const expr = `resource_type:image AND tags=${TAGS.tile} AND (${missing.map(c => `context.code="${c}"`).join(" OR ")})`;
      (await search(expr)).forEach(r => { const c = ctxOf(r); rows.push({ public_id: r.public_id, cat: c.cat || "", code: c.code || "", orig: c.orig || "", page: Number(c.page || 0), n: Number(c.n || 0) }); });
    } catch (e) { console.warn("findCodes search", e.message); }
  }
  return rows.map(r => rowToTile(r, env.cloud));
}

/** Short-lived download link for a stored PDF (only used server-side or handed to the admin). */
export function downloadUrl(publicId, minutes = 10) {
  const env = cloudEnv();
  const timestamp = Math.floor(Date.now() / 1000);
  const params = { expires_at: timestamp + minutes * 60, public_id: publicId, timestamp, type: "authenticated" };
  const q = new URLSearchParams({ ...params, api_key: env.key, signature: signParams(params, env.secret) });
  return `https://api.cloudinary.com/v1_1/${env.cloud}/raw/download?${q}`;
}

/** Signature for one direct browser upload. */
export function signUpload({ resourceType, publicId, context, tags, authenticated }) {
  const env = cloudEnv();
  const timestamp = Math.floor(Date.now() / 1000);
  const params = { context, public_id: publicId, tags, timestamp, ...(authenticated ? { type: "authenticated" } : {}) };
  return { cloud: env.cloud, apiKey: env.key, resourceType, ...params, signature: signParams(params, env.secret) };
}

/** Replace the context of one resource. */
export async function setContext({ resourceType, type, publicId, context }) {
  const env = cloudEnv();
  const timestamp = Math.floor(Date.now() / 1000);
  const params = { context, public_id: publicId, timestamp, type };
  const form = new URLSearchParams({ ...params, api_key: env.key, signature: signParams(params, env.secret) });
  const r = await fetch(`https://api.cloudinary.com/v1_1/${env.cloud}/${resourceType}/explicit`, { method: "POST", body: form });
  const j = await r.json();
  if (!r.ok || j.error) throw new Error(j.error?.message || `Cloudinary ${r.status}`);
  return j;
}

export async function destroy({ resourceType, type, publicId }) {
  const env = cloudEnv();
  const timestamp = Math.floor(Date.now() / 1000);
  const params = { invalidate: "true", public_id: publicId, timestamp, type };
  const form = new URLSearchParams({ ...params, api_key: env.key, signature: signParams(params, env.secret) });
  const r = await fetch(`https://api.cloudinary.com/v1_1/${env.cloud}/${resourceType}/destroy`, { method: "POST", body: form });
  const j = await r.json();
  if (!r.ok || j.error) throw new Error(j.error?.message || `Cloudinary ${r.status}`);
  return j;
}

/** Delete everything stored for one catalogue. */
export async function deleteCatalogue(cat) {
  const env = cloudEnv();
  if (!cat || !cat.dir) throw new Error("Bad catalogue");
  const prefix = encodeURIComponent(`catalogues/${cat.dir}/`);
  if ([cat.supplier, cat.branded, cat.preview].some(isHost)) await hostDeleteDir(cat.dir);
  if (accountsReady()) {
    await db(`catalogue_tiles?public_id=like.${encodeURIComponent(`catalogues/${cat.dir}/*`)}`, { method: "DELETE" }).catch(e => console.warn("delete tiles", e.message));
    await db(`catalogues?slug=eq.${encodeURIComponent(cat.slug)}`, { method: "DELETE" });
  }
  for (const path of ["image/upload", "raw/authenticated"]) {
    for (let i = 0; i < 5; i++) {
      const r = await fetch(`https://api.cloudinary.com/v1_1/${env.cloud}/resources/${path}?prefix=${prefix}&invalidate=true`, { method: "DELETE", headers: auth(env) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error?.message || `Cloudinary ${r.status}`);
      if (!j.partial) break;
    }
  }
}

export const catalogueContext = c => [
  `name=${cleanCtx(c.name)}`, `slug=${c.slug}`, `dir=${cleanCtx(c.dir || c.slug)}`, `prefix=${cleanCtx(c.prefix)}`, `sprefix=${cleanCtx(c.sprefix)}`,
  `status=${c.status === "published" ? "published" : "draft"}`, `count=${Number(c.count) || 0}`,
  `branded=${cleanCtx(c.branded)}`, `preview=${cleanCtx(c.preview)}`
].join("|");
