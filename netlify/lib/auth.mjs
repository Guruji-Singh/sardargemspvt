// Customer accounts: Supabase database access, password hashing, login tokens, GSTIN checks.
// Needs Netlify env var SUPABASE_SERVICE_KEY (Supabase → Project Settings → API Keys → secret key).

import { scryptSync, randomBytes, timingSafeEqual, createHmac, createHash } from "node:crypto";

export const SUPABASE_URL = process.env.SUPABASE_URL || "https://jwhwkjcnmbhsvzgqtotw.supabase.co";
const KEY = () => process.env.SUPABASE_SERVICE_KEY || "";
export const accountsReady = () => !!KEY();

/* ---------- Supabase REST ---------- */
export async function db(path, { method = "GET", body, prefer } = {}) {
  const key = KEY();
  const headers = { apikey: key, "Content-Type": "application/json" };
  if (!key.startsWith("sb_")) headers.Authorization = `Bearer ${key}`;      // legacy service_role JWT
  if (prefer) headers.Prefer = prefer;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let data = null; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const msg = (data && (data.message || data.hint || data.error)) || `Database error ${res.status}`;
    throw Object.assign(new Error(msg), { status: res.status, code: data && data.code });
  }
  return data;
}

/* ---------- passwords ---------- */
export function hashPassword(pw) {
  const salt = randomBytes(16);
  const hash = scryptSync(String(pw), salt, 32);
  return `scrypt$${salt.toString("base64")}$${hash.toString("base64")}`;
}
export function checkPassword(pw, stored) {
  try {
    const [, s, h] = String(stored).split("$");
    const want = Buffer.from(h, "base64");
    const got = scryptSync(String(pw), Buffer.from(s, "base64"), want.length);
    return timingSafeEqual(want, got);
  } catch { return false; }
}

/* ---------- login tokens (signed, 60 days) ---------- */
const secret = () => createHash("sha256").update("sjh-session|" + (process.env.SESSION_SECRET || KEY())).digest();
const b64u = b => Buffer.from(b).toString("base64url");
export function makeToken(user) {
  const payload = b64u(JSON.stringify({ u: user.id, v: user.session_version || 0, exp: Date.now() + 60 * 864e5 }));
  const sig = createHmac("sha256", secret()).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}
export function readToken(token) {
  if (!token || !token.includes(".")) return null;
  const [payload, sig] = token.split(".");
  const want = createHmac("sha256", secret()).update(payload).digest("base64url");
  if (sig.length !== want.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return null;
  try {
    const p = JSON.parse(Buffer.from(payload, "base64url").toString());
    return p.exp > Date.now() ? p : null;
  } catch { return null; }
}

/** Who is calling? Returns the customer row (id, name, shop, status) or null for guests. */
export async function viewerFrom(req) {
  if (!accountsReady()) return null;
  const auth = req.headers.get("authorization") || "";
  const p = readToken(auth.replace(/^Bearer\s+/i, ""));
  if (!p) return null;
  try {
    const rows = await db(`customers?id=eq.${encodeURIComponent(p.u)}&select=id,name,shop,city,state,status,session_version`);
    const u = rows && rows[0];
    if (!u || u.session_version !== p.v) return null;      // logged out by admin (blocked / password reset)
    return u;
  } catch { return null; }
}

/* ---------- phone + GSTIN ---------- */
export function normPhone(p) {
  const d = String(p || "").replace(/\D/g, "");
  const ten = d.length > 10 ? d.slice(-10) : d;
  return /^[6-9]\d{9}$/.test(ten) ? ten : null;
}

const GST_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
/** Format + check-digit test. (Does not confirm the GSTIN is registered with the government.) */
export function validGstin(g) {
  g = String(g || "").toUpperCase().replace(/\s/g, "");
  if (!/^[0-3][0-9][A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(g)) return null;
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const v = GST_CHARS.indexOf(g[i]) * (i % 2 ? 2 : 1);
    sum += Math.floor(v / 36) + (v % 36);
  }
  const check = GST_CHARS[(36 - (sum % 36)) % 36];
  return check === g[14] ? g : null;
}

export const GST_STATES = { "01":"Jammu and Kashmir","02":"Himachal Pradesh","03":"Punjab","04":"Chandigarh","05":"Uttarakhand","06":"Haryana","07":"Delhi","08":"Rajasthan","09":"Uttar Pradesh","10":"Bihar","11":"Sikkim","12":"Arunachal Pradesh","13":"Nagaland","14":"Manipur","15":"Mizoram","16":"Tripura","17":"Meghalaya","18":"Assam","19":"West Bengal","20":"Jharkhand","21":"Odisha","22":"Chhattisgarh","23":"Madhya Pradesh","24":"Gujarat","26":"Dadra and Nagar Haveli and Daman and Diu","27":"Maharashtra","29":"Karnataka","30":"Goa","31":"Lakshadweep","32":"Kerala","33":"Tamil Nadu","34":"Puducherry","35":"Andaman and Nicobar Islands","36":"Telangana","37":"Andhra Pradesh","38":"Ladakh" };
