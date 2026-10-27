// GET /api/feed — everything the website shows, filtered by who is looking.
//   Guests and accounts awaiting approval: first 10 designs per category.
//   Approved customers: everything.
// Sources: admin uploads (Cloudinary), media/ folder in GitHub, Instagram (product posts only).

import { CATEGORIES, categoriesFromCaption, purityFromCaption, catFromSlug } from "../lib/catalog.mjs";
import { listProducts } from "../lib/cloud.mjs";
import { viewerFrom, accountsReady } from "../lib/auth.mjs";
import MEDIA from "../lib/media-list.mjs";

const GUEST_LIMIT = 10;
const cache = { products: { at: 0, data: [] }, ig: { at: 0, data: [] } };

async function cached(key, ttl, fn) {
  const c = cache[key];
  if (Date.now() - c.at < ttl) return c.data;
  try { c.data = await fn(); c.at = Date.now(); } catch (e) { console.warn(key, e.message); c.at = Date.now() - ttl + 15000; }
  return c.data;
}

export default async (req) => {
  const origin = new URL(req.url).origin;
  const [products, igRaw, viewer] = await Promise.all([
    cached("products", 60e3, listProducts),
    cached("ig", 300e3, async () => {
      const r = await fetch(origin + "/api/instagram");          // CDN-cached Instagram function
      const j = await r.json();
      if (!r.ok || j.error) throw new Error(j.error || r.status);
      return j.items || [];
    }),
    viewerFrom(req)
  ]);

  // 1) normalise every source to { ...item, cats:[slug], purity:[...] }
  const uploads = products.map(it => ({ ...it, cats: [catFromSlug(it.cat)] }));
  const media = MEDIA.map(it => ({ ...it, source: "media", cats: [catFromSlug(it.folder)], purity: it.purity || [] }));
  const ig = igRaw
    .map(it => ({ ...it, source: "instagram", cats: categoriesFromCaption(it.caption), purity: purityFromCaption(it.caption) }))
    .filter(it => it.cats.length && it.src);                      // product posts only (no greetings/promos)
  const all = [...uploads, ...media, ...ig];

  // 2) access level
  // Until accounts are switched on (SUPABASE_SERVICE_KEY set), show everything so nobody is locked out.
  const full = !accountsReady() || !!(viewer && viewer.status === "approved");
  const shownPer = {}, totals = {};
  CATEGORIES.forEach(c => { shownPer[c.slug] = 0; totals[c.slug] = 0; });
  all.forEach(it => it.cats.forEach(s => totals[s]++));

  const visible = [];
  for (const it of all) {
    const ok = full || it.cats.some(s => shownPer[s] < GUEST_LIMIT);
    if (!ok) continue;
    it.cats.forEach(s => shownPer[s]++);
    const { publicId, resourceType, ...pub } = it;
    visible.push(pub);
  }

  // 3) hero: latest Instagram product reels
  const hero = ig.filter(it => it.type === "video").slice(0, 6).map(({ id, src, thumbnail, cats, permalink, purity, timestamp }) =>
    ({ id, src, thumbnail, cats, permalink, purity, timestamp, type: "video", source: "instagram" }));

  return Response.json({
    viewer: viewer ? { name: viewer.name, shop: viewer.shop, status: viewer.status } : null,
    accounts: accountsReady(),
    full, guestLimit: GUEST_LIMIT,
    categories: CATEGORIES.map(c => ({ name: c.name, slug: c.slug, total: totals[c.slug], shown: full ? totals[c.slug] : Math.min(totals[c.slug], shownPer[c.slug]) })),
    hero, items: visible
  }, { headers: { "Cache-Control": "private, no-store" } });
};

export const config = { path: "/api/feed" };
