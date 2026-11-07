// GET /api/catalogues — published catalogues and their designs, for the website's catalogue picker.
//   Approved retailers: every design.  Guests / accounts awaiting approval: the first few of each catalogue.
// Supplier codes are never sent to the website.

import { viewerFrom, accountsReady } from "../lib/auth.mjs";
import { listCatalogues, listTiles, debugTiles } from "../lib/catalogues.mjs";
import { cloudEnv } from "../lib/cloud.mjs";

const GUEST_DESIGNS = 4;
const cache = { at: 0, data: [], info: {} };

async function published() {
  if (Date.now() - cache.at < 180e3) return cache.data;     // 3 min: keeps Cloudinary API use low
  const every = await listCatalogues();
  const cats = every.filter(c => c.status === "published");
  cache.info = { stored: every.length, published: cats.length };
  const withTiles = await Promise.all(cats.map(async c => {
    try { return { ...c, tiles: await listTiles(c) }; }
    catch (e) { console.warn("catalogue tiles", c.slug, e.message); cache.info.tileError = e.message; return { ...c, tiles: [] }; }
  }));
  cache.at = Date.now(); cache.data = withTiles;
  cache.info.withDesigns = withTiles.filter(c => c.tiles.length).length;
  return withTiles;
}

export default async (req) => {
  if (!cloudEnv()) return Response.json({ catalogues: [] });
  let problem = "";
  const [cats, viewer] = await Promise.all([published().catch(e => { console.warn("catalogues", e.message); problem = e.message; return []; }), viewerFrom(req)]);
  if (new URL(req.url).searchParams.get("debug") === "1") {
    const first = cache.data[0] || (await listCatalogues().catch(() => []))[0];
    return Response.json({ slug: first && first.slug, dir: first && first.dir, ...(await debugTiles(first ? first.dir : "x")) });
  }
  const full = !accountsReady() || !!(viewer && viewer.status === "approved");
  return Response.json({
    full, ...(problem ? { problem } : {}), info: cache.info,
    catalogues: cats.filter(c => c.tiles.length).map(c => ({
      slug: c.slug, name: c.name, total: c.tiles.length,
      pdf: !!c.branded, preview: !!c.preview,
      cover: c.tiles[0] ? c.tiles[0].thumb : "",
      designs: (full ? c.tiles : c.tiles.slice(0, GUEST_DESIGNS)).map(t => ({ code: t.code, thumb: t.thumb, src: t.src }))
    }))
  }, { headers: { "Cache-Control": "private, no-store" } });
};

export const config = { path: "/api/catalogues" };
