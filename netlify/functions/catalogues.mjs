// GET /api/catalogues — published catalogues and their designs, for the website's catalogue picker.
//   Approved retailers: every design.  Guests / accounts awaiting approval: the first few of each catalogue.
// Supplier codes are never sent to the website.

import { viewerFrom, accountsReady } from "../lib/auth.mjs";
import { listCatalogues, listTiles } from "../lib/catalogues.mjs";
import { cloudEnv } from "../lib/cloud.mjs";

const GUEST_DESIGNS = 4;
const cache = { at: 0, data: [] };

async function published() {
  if (Date.now() - cache.at < 60e3) return cache.data;
  const cats = (await listCatalogues()).filter(c => c.status === "published");
  const withTiles = await Promise.all(cats.map(async c => ({ ...c, tiles: await listTiles(c.slug) })));
  cache.at = Date.now(); cache.data = withTiles;
  return withTiles;
}

export default async (req) => {
  if (!cloudEnv()) return Response.json({ catalogues: [] });
  const [cats, viewer] = await Promise.all([published().catch(e => { console.warn("catalogues", e.message); return []; }), viewerFrom(req)]);
  const full = !accountsReady() || !!(viewer && viewer.status === "approved");
  return Response.json({
    full,
    catalogues: cats.map(c => ({
      slug: c.slug, name: c.name, total: c.tiles.length,
      pdf: !!c.branded, preview: !!c.preview,
      cover: c.tiles[0] ? c.tiles[0].thumb : "",
      designs: (full ? c.tiles : c.tiles.slice(0, GUEST_DESIGNS)).map(t => ({ code: t.code, thumb: t.thumb, src: t.src }))
    }))
  }, { headers: { "Cache-Control": "private, no-store" } });
};

export const config = { path: "/api/catalogues" };
