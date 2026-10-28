// Wrong-password limits for admin and retailer logins.
// After too many wrong tries, that key (an IP address, a phone number, or the admin page) is locked for a while.
// Counters live in Supabase table public.login_attempts (server-only).

import { db, accountsReady } from "./auth.mjs";

export const RULES = {
  adminIp:  { max: 5,  window: 15 * 60, lock: 30 * 60 },   // per IP on the admin page
  adminAll: { max: 40, window: 60 * 60, lock: 30 * 60 },   // whole admin page (many IPs guessing)
  phone:    { max: 5,  window: 15 * 60, lock: 15 * 60 },   // per retailer mobile number
  ip:       { max: 20, window: 15 * 60, lock: 15 * 60 },   // per IP on retailer login
};

export function clientIp(req) {
  return req.headers.get("x-nf-client-connection-ip")
      || (req.headers.get("x-forwarded-for") || "").split(",")[0].trim()
      || "unknown";
}

/** Minutes left on a lock for any of the keys, or 0 if free. */
export async function lockedFor(keys) {
  if (!accountsReady()) return 0;
  try {
    const list = keys.map(k => `"${String(k).replace(/"/g, "")}"`).join(",");
    const rows = await db(`login_attempts?key=in.(${encodeURIComponent(list)})&select=locked_until`);
    const until = Math.max(0, ...rows.map(r => r.locked_until ? Date.parse(r.locked_until) : 0));
    return until > Date.now() ? Math.ceil((until - Date.now()) / 60000) : 0;
  } catch { return 0; }
}

/** Count one wrong try against each [key, rule] pair. */
export async function recordFail(pairs) {
  if (!accountsReady()) return;
  await Promise.all(pairs.map(([k, r]) =>
    db("rpc/login_fail", { method: "POST", body: { k, max_fails: r.max, window_secs: r.window, lock_secs: r.lock } }).catch(() => {})
  ));
}

/** Clear counters after a correct password. */
export async function clearFails(keys) {
  if (!accountsReady()) return;
  const list = keys.map(k => `"${String(k).replace(/"/g, "")}"`).join(",");
  await db(`login_attempts?key=in.(${encodeURIComponent(list)})`, { method: "DELETE" }).catch(() => {});
}

export const lockedMsg = m => `Too many wrong tries. Please try again in ${m} minute${m === 1 ? "" : "s"}.`;
