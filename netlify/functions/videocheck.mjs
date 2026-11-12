// GET /api/videocheck — shows why billing-app videos are or aren't on the site.
// Reports counts, Cloudinary plan usage, and tries one waiting video now (not in the
// background) so Cloudinary's own error message is visible. Shows no keys or prices.
import { cloudEnv, signParams } from "../lib/cloud.mjs";
import { loadStock } from "../lib/elysian.mjs";

const out = (d, s = 200) => Response.json(d, { status: s, headers: { "Cache-Control": "no-store" } });
const baseName = u => decodeURIComponent(u.split("/").pop() || "").replace(/\.[^.]+$/, "").replace(/[^A-Za-z0-9_-]/g, "_");
let lastTry = 0;

export default async () => {
  const env = cloudEnv();
  if (!env) return out({ problem: "Cloudinary keys are not set on the website" });
  const auth = { Authorization: "Basic " + btoa(`${env.key}:${env.secret}`) };
  const res = {};

  try {
    const u = await (await fetch(`https://api.cloudinary.com/v1_1/${env.cloud}/usage`, { headers: auth })).json();
    res.cloudinary_plan = u.plan;
    res.credits_used_percent = u.credits?.used_percent;
    res.error = u.error?.message;
  } catch (e) { res.usage_error = e.message; }

  let stock;
  try { stock = await loadStock(); } catch (e) { return out({ ...res, problem: "Stock list: " + e.message }); }
  const vids = stock.items.filter(s => s.video);
  const have = new Set();
  let cursor = "";
  for (let i = 0; i < 5; i++) {
    const r = await fetch(`https://api.cloudinary.com/v1_1/${env.cloud}/resources/video/upload?prefix=elysian/&max_results=500${cursor ? "&next_cursor=" + cursor : ""}`, { headers: auth });
    const j = await r.json();
    if (!r.ok) { res.list_error = j.error?.message || r.status; break; }
    (j.resources || []).forEach(x => have.add(x.public_id));
    if (!(cursor = j.next_cursor)) break;
  }
  const missing = vids.filter(s => !have.has("elysian/" + baseName(s.video)));
  Object.assign(res, { in_stock_with_video: vids.length, on_cloudinary: vids.length - missing.length, waiting: missing.length,
    waiting_codes: missing.slice(0, 40).map(s => s.code) });

  // try the first waiting one now, at most once a minute
  if (missing.length && Date.now() - lastTry > 60e3) {
    lastTry = Date.now();
    const s = missing[0], id = "elysian/" + baseName(s.video);
    const head = await fetch(s.video, { method: "HEAD" }).catch(e => ({ status: "fetch failed: " + e.message, headers: new Headers() }));
    res.test_file = { code: s.code, url_status: head.status, type: head.headers.get("content-type"), bytes: head.headers.get("content-length") };
    const timestamp = Math.floor(Date.now() / 1000);
    const params = { overwrite: "false", public_id: id, tags: "elysian", timestamp };
    const form = new URLSearchParams({ ...params, file: s.video, api_key: env.key, signature: signParams(params, env.secret) });
    const r = await fetch(`https://api.cloudinary.com/v1_1/${env.cloud}/video/upload`, { method: "POST", body: form });
    const j = await r.json().catch(() => ({}));
    res.test_upload = r.ok && !j.error ? "worked – this video is now on Cloudinary" : (j.error?.message || `HTTP ${r.status}`);
  }
  try {
    const r = await fetch("https://new.sardargems.com/api/index.php?action=media_report", { headers: { "X-Api-Key": process.env.STOCK_API_KEY || "" } });
    const j = await r.json();
    if (j.ok) { res.files_on_server = j.data.summary; res.videos = j.data.videos; } else res.report_error = j.error || r.status;
  } catch (e) { res.report_error = e.message; }
  return out(res);
};

export const config = { path: "/api/videocheck" };
