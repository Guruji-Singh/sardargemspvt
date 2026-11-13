// GET /api/stock — live ready stock from the billing app (new.sardargems.com, on Hostinger).
//   Approved retailers: every piece in stock (code, item, karat, weights, photo, video).
//   Guests and accounts awaiting approval: only how many pieces are in stock.
// Needs env var STOCK_API_KEY (the feed address is fixed in netlify/lib/elysian.mjs).

import { viewerFrom, accountsReady } from "../lib/auth.mjs";
import { loadStock } from "../lib/elysian.mjs";

const out = (data, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "private, no-store" } });

export default async (req) => {
  const viewer = await viewerFrom(req);
  const full = accountsReady() && viewer && viewer.status === "approved";
  let stock;
  try { stock = await loadStock(); } catch (e) { console.warn("stock", e.message); return out({ error: "Stock is not available right now" }, 503); }
  if (!full) return out({ locked: true, count: stock.count, reason: viewer ? "pending" : "guest" });
  return out({ locked: false, count: stock.count, updated: stock.generated_at, items: stock.items });
};

export const config = { path: "/api/stock" };
