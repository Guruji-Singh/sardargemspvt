// Cloudflare Pages adapter: runs the site's functions (written in netlify/functions) unchanged.
// Copies the project's environment variables into process.env, which those functions read.
export const wrap = (handler) => async (ctx) => {
  for (const [k, v] of Object.entries(ctx.env || {})) if (typeof v === "string") process.env[k] = v;
  return handler(ctx.request, ctx);
};
