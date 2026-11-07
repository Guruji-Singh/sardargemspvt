// Ready stock from the billing software (Elysian, on Hostinger) and its photos/videos.
//
// The stock list comes from office.sardargems.com/sjh-website/stock.php (env STOCK_API_URL + STOCK_API_KEY).
// Photos and videos are copied once into Cloudinary (folder "elysian/", tag "elysian") so the website can serve
// them small and fast: photos as WebP/AVIF, iPhone .mov videos as .mp4 that plays on every phone.
// Until a file has been copied, photos load straight from Hostinger and videos are left out.

import { cloudEnv, signParams } from "./cloud.mjs";
import { categoriesFromCaption } from "./catalog.mjs";

const FOLDER = "elysian";
const cache = { stock: { at: 0, data: null }, synced: { at: 0, data: null } };
const pending = new Set();

export async function loadStock() {
  if (cache.stock.data && Date.now() - cache.stock.at < 60e3) return cache.stock.data;
  const url = process.env.STOCK_API_URL, key = process.env.STOCK_API_KEY;
  if (!url || !key) throw new Error("Stock link not set up");
  const r = await fetch(url, { headers: { "X-Api-Key": key, "Accept": "application/json" } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !Array.isArray(j.items)) throw new Error(j.error || `Stock API ${r.status}`);
  cache.stock = { at: Date.now(), data: j };
  return j;
}

const baseName = u => decodeURIComponent(u.split("/").pop() || "").replace(/\.[^.]+$/, "").replace(/[^A-Za-z0-9_-]/g, "_");

/** public_ids already in Cloudinary, e.g. Set{"image:elysian/2026...", "video:elysian/2026..."} */
async function syncedIds(env) {
  if (cache.synced.data && Date.now() - cache.synced.at < 10 * 60e3) return cache.synced.data;
  const ids = new Set();
  for (const type of ["image", "video"]) {
    let cursor = "";
    for (let i = 0; i < 5; i++) {
      const r = await fetch(`https://api.cloudinary.com/v1_1/${env.cloud}/resources/${type}/upload?prefix=${FOLDER}/&max_results=500${cursor ? "&next_cursor=" + cursor : ""}`,
        { headers: { Authorization: "Basic " + btoa(`${env.key}:${env.secret}`) } });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error?.message || `Cloudinary ${r.status}`);
      (j.resources || []).forEach(x => ids.add(`${type}:${x.public_id}`));
      if (!(cursor = j.next_cursor)) break;
    }
  }
  cache.synced = { at: Date.now(), data: ids };
  return ids;
}

async function copyToCloudinary(env, type, fileUrl, publicId) {
  const timestamp = Math.floor(Date.now() / 1000);
  const params = { public_id: publicId, tags: FOLDER, timestamp };
  const form = new URLSearchParams({ ...params, file: fileUrl, api_key: env.key, signature: signParams(params, env.secret) });
  const r = await fetch(`https://api.cloudinary.com/v1_1/${env.cloud}/${type}/upload`, { method: "POST", body: form });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(j.error?.message || `upload ${r.status}`);
  cache.synced.data && cache.synced.data.add(`${type}:${publicId}`);
}

/** Stock pieces that have a photo or video, as website items. `later(promise)` runs work after the reply. */
export async function stockItems(later) {
  const stock = await loadStock();
  const env = cloudEnv();
  let ids = new Set();
  if (env) { try { ids = await syncedIds(env); } catch (e) { console.warn("elysian sync list", e.message); } }
  const base = env ? `https://res.cloudinary.com/${env.cloud}` : "";
  const toCopy = [];
  const items = [];

  for (const s of stock.items) {
    if (!s.image && !s.video) continue;
    const imgId = s.image ? `${FOLDER}/${baseName(s.image)}` : "", vidId = s.video ? `${FOLDER}/${baseName(s.video)}` : "";
    const hasImg = imgId && ids.has(`image:${imgId}`), hasVid = vidId && ids.has(`video:${vidId}`);
    if (env && s.image && !hasImg) toCopy.push(["image", s.image, imgId]);
    if (env && s.video && !hasVid) toCopy.push(["video", s.video, vidId]);

    const common = {
      id: "ely_" + s.id, source: "elysian", code: s.code, caption: s.name,
      cats: (() => { const c = categoriesFromCaption(s.name); return c.length ? c : ["other-designs"]; })(),
      purity: s.karat ? [`${s.karat}K`] : [], weight: s.net_weight || s.gross_weight || 0, permalink: "", timestamp: ""
    };
    if (hasVid) {
      items.push({ ...common, type: "video",
        src: `${base}/video/upload/q_auto,w_720,c_limit/${vidId}.mp4`,
        thumbnail: hasImg ? `${base}/image/upload/f_auto,q_auto,w_480,c_limit/${imgId}` : `${base}/video/upload/so_0,q_auto,w_480,c_limit/${vidId}.jpg`,
        preview: `${base}/video/upload/q_auto:low,w_480,c_limit,ac_none/${vidId}.mp4` });
    } else if (s.image) {
      items.push({ ...common, type: "image",
        src: hasImg ? `${base}/image/upload/f_auto,q_auto,w_1080,c_limit/${imgId}` : s.image,
        thumbnail: hasImg ? `${base}/image/upload/f_auto,q_auto,w_480,c_limit/${imgId}` : s.image });
    }
  }

  // Copy a few new files per visit, in the background.
  const batch = toCopy.filter(([t, , id]) => !pending.has(t + id)).slice(0, 4);
  if (batch.length && env) {
    batch.forEach(([t, , id]) => pending.add(t + id));
    const job = Promise.all(batch.map(([t, url, id]) => copyToCloudinary(env, t, url, id)
      .catch(e => console.warn("elysian copy", id, e.message))
      .finally(() => pending.delete(t + id))));
    later ? later(job) : await job;
  }
  return items;
}
