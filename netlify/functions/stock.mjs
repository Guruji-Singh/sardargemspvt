// GET /api/stock — live ready stock from the billing software (Elysian, on Hostinger).
//   Approved retailers: every piece in stock (code, item, karat, weights, photo, video).
//   Guests and accounts awaiting approval: only how many pieces are in stock.
// Needs env vars STOCK_API_URL (https://office.sardargems.com/sjh-website/stock.php) and STOCK_API_KEY.

import { viewerFrom, accountsReady } from "../lib/auth.mjs";

const cache = { at: 0, data: null };
const out = (data, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "private, no-store" } });

async function loadStock() {
  if (cache.data && Date.now() - cache.at < 60e3) return cache.data;
  const url = process.env.STOCK_API_URL, key = process.env.STOCK_API_KEY;
  if (!url || !key) throw new Error("Stock link not set up");
  const r = await fetch(url, { headers: { "X-Api-Key": key, "Accept": "application/json" } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !Array.isArray(j.items)) throw new Error(j.error || `Stock API ${r.status}`);
  cache.data = j; cache.at = Date.now();
  return j;
}

export default async (req) => {
  const viewer = await viewerFrom(req);
  const full = accountsReady() && viewer && viewer.status === "approved";
  let stock;
  try { stock = await loadStock(); } catch (e) { console.warn("stock", e.message); return out({ error: "Stock is not available right now" }, 503); }
  if (!full) return out({ locked: true, count: stock.count, reason: viewer ? "pending" : "guest" });
  return out({ locked: false, count: stock.count, updated: stock.generated_at, items: stock.items });
};

export const config = { path: "/api/stock" };
