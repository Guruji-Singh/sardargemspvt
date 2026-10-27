// Cloudinary helpers shared by the feed and the admin functions.
import { createHash } from "node:crypto";

export const TAG = "sardar";
export const cloudEnv = () => {
  const { CLOUDINARY_CLOUD_NAME: cloud, CLOUDINARY_API_KEY: key, CLOUDINARY_API_SECRET: secret } = process.env;
  return cloud && key && secret ? { cloud, key, secret } : null;
};
export const signParams = (params, secret) =>
  createHash("sha1").update(Object.keys(params).sort().map(k => `${k}=${params[k]}`).join("&") + secret).digest("hex");

/** All product uploads (newest first), converted to site items. */
export async function listProducts() {
  const env = cloudEnv();
  if (!env) return [];
  const items = [];
  let cursor;
  for (let i = 0; i < 5; i++) {
    const res = await fetch(`https://api.cloudinary.com/v1_1/${env.cloud}/resources/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Basic " + btoa(`${env.key}:${env.secret}`) },
      body: JSON.stringify({ expression: `tags=${TAG}`, with_field: ["context", "tags"], sort_by: [{ created_at: "desc" }], max_results: 500, ...(cursor ? { next_cursor: cursor } : {}) })
    });
    const j = await res.json();
    if (!res.ok || j.error) throw new Error(j.error?.message || `Cloudinary ${res.status}`);
    for (const r of j.resources || []) items.push(toItem(r, env.cloud));
    cursor = j.next_cursor;
    if (!cursor) break;
  }
  return items;
}

function toItem(r, cloud) {
  const c = (r.context && (r.context.custom || r.context)) || {};
  const base = `https://res.cloudinary.com/${cloud}`;
  const v = r.resource_type === "video", id = r.public_id;
  return {
    id: "cld_" + id, publicId: id, resourceType: r.resource_type, source: "upload",
    type: v ? "video" : "image",
    src: v ? `${base}/video/upload/q_auto,w_720,c_limit/${id}.mp4` : `${base}/image/upload/f_auto,q_auto,w_1080,c_limit/${id}`,
    thumbnail: v ? `${base}/video/upload/so_0,q_auto,w_480,c_limit/${id}.jpg` : `${base}/image/upload/f_auto,q_auto,w_480,c_limit/${id}`,
    preview: v ? `${base}/video/upload/q_auto:low,w_480,c_limit,ac_none/${id}.mp4` : "",
    code: c.code || "", caption: c.code || "", cat: c.cat || "",
    purity: c.purity ? String(c.purity).split(",").filter(Boolean) : [],
    permalink: "", timestamp: r.created_at
  };
}

/** Upload a visiting-card photo (data URL) to a private-ish folder; returns its URL. */
export async function uploadCard(dataUrl, phone) {
  const env = cloudEnv();
  if (!env) throw new Error("Photo upload not configured");
  const timestamp = Math.floor(Date.now() / 1000);
  const params = { folder: "sardar-cards", public_id: `${phone}-${timestamp}-${Math.random().toString(36).slice(2, 10)}`, timestamp };
  const form = new URLSearchParams({ ...params, file: dataUrl, api_key: env.key, signature: signParams(params, env.secret) });
  const res = await fetch(`https://api.cloudinary.com/v1_1/${env.cloud}/image/upload`, { method: "POST", body: form });
  const j = await res.json();
  if (!res.ok || j.error) throw new Error(j.error?.message || "Card upload failed");
  return j.secure_url;
}
