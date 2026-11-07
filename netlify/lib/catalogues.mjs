// Catalogues made from supplier PDFs (admin page → Catalogues tab).
//
// Everything is stored in Cloudinary, under catalogues/<dir>/ (dir = slug + random part, so a deleted
// catalogue's background clean-up can never touch a new one with the same name):
//   supplier-<rand>.dat   the supplier's original PDF        raw, authenticated   tag sjh-catalogue
//   branded-<rand>.dat    our branded PDF (all designs)      raw, authenticated   tag sjh-catalogue-pdf
//   preview-<rand>.dat    our branded PDF, first 2 pages     raw, authenticated   tag sjh-catalogue-pdf
//   <nn>-<rand>           one design tile (JPEG)             image, upload        tag sjh-tile
// PDFs are stored as .dat and always served through our own /api/catalogue, never straight from Cloudinary.
//
// The supplier PDF's context holds the catalogue's details:
//   name, slug, prefix (our code prefix, e.g. SJH-DE), sprefix (supplier's, e.g. DCLE), status (draft|published),
//   count, branded, preview  (public_ids of the branded PDFs)
// Each tile's context: cat (slug), code (SJH-DE-03), orig (DCLE 3), page (3), n (3)

import { cloudEnv, signParams } from "./cloud.mjs";

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

export async function listCatalogues() {
  return (await listByPrefix("raw/authenticated", "catalogues/"))
    .filter(r => (r.tags || []).includes(TAGS.cat))
    .map(catalogueFromResource).filter(c => c.slug && SLUG.test(c.slug))
    .sort((a, b) => String(b.created).localeCompare(String(a.created)));
}

export async function getCatalogue(slug) {
  if (!SLUG.test(slug)) return null;
  return (await listCatalogues()).find(c => c.slug === slug) || null;
}

/** Designs of one catalogue (pass the catalogue from listCatalogues/getCatalogue). */
export async function listTiles(cat) {
  const env = cloudEnv();
  if (!cat || !cat.dir) return [];
  const isTile = r => !r.tags || r.tags.includes(TAGS.tile);
  // Two sources: the direct list (up to date) and search (can lag a few minutes). Use whichever has more.
  const [a, b] = await Promise.allSettled([
    listByPrefix("image/upload", `catalogues/${cat.dir}/`).then(rows => rows.filter(isTile)),
    search(`resource_type:image AND tags=${TAGS.tile} AND context.cat="${cat.slug}"`)
  ]);
  const rowsA = a.status === "fulfilled" ? a.value : [], rowsB = b.status === "fulfilled" ? b.value : [];
  if (!rowsA.length && !rowsB.length && a.status === "rejected") throw a.reason;
  const byId = new Map();
  [...rowsB, ...rowsA].forEach(r => byId.set(r.public_id, r));
  return [...byId.values()].map(r => tileFromResource(r, env.cloud)).sort((x, y) => (x.n - y.n) || x.publicId.localeCompare(y.publicId));
}

/** Tiles whose code is in `codes` (up to 60 at a time). */
export async function findCodes(codes) {
  const env = cloudEnv();
  const list = [...new Set(codes.map(c => cleanCtx(c).toUpperCase()).filter(Boolean))].slice(0, 60);
  if (!list.length) return [];
  const expr = `resource_type:image AND tags=${TAGS.tile} AND (${list.map(c => `context.code="${c}"`).join(" OR ")})`;
  return (await search(expr)).map(r => tileFromResource(r, env.cloud));
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
