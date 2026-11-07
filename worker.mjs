// Cloudflare Worker entry for www.sardargems.com.
// /api/* runs the site's functions (netlify/functions, unchanged); everything else is a static file.
import account from "./netlify/functions/account.mjs";
import admin from "./netlify/functions/admin.mjs";
import catalogue from "./netlify/functions/catalogue.mjs";
import feed from "./netlify/functions/feed.mjs";
import instagram from "./netlify/functions/instagram.mjs";
import products from "./netlify/functions/products.mjs";
import stock from "./netlify/functions/stock.mjs";

const ROUTES = { account, admin, catalogue, feed, instagram, products, stock };
const SECURITY = {
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Strict-Transport-Security": "max-age=31536000"
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const m = url.pathname.match(/^\/api\/([a-z]+)\/?$/);
    if (!m) return env.ASSETS.fetch(request);
    const handler = ROUTES[m[1]];
    if (!handler) return Response.json({ error: "Not found" }, { status: 404 });
    for (const [k, v] of Object.entries(env)) if (typeof v === "string") process.env[k] = v;
    const res = await handler(request, { env, waitUntil: p => ctx.waitUntil(p) });
    const out = new Response(res.body, res);
    for (const [k, v] of Object.entries(SECURITY)) out.headers.set(k, v);
    return out;
  }
};
