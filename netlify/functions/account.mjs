// POST /api/account — retailer sign-up and login.
//   { action:"register", phone, password, name, shop, city, state, gstin?, card? (image data URL) }
//   { action:"login", phone, password }
//   { action:"me" }   (with Authorization: Bearer <token>)
//
// Approval rules
//   • Shop in Punjab (chosen state, or GSTIN starting 03)  -> waits for manual approval
//   • Valid GSTIN (outside Punjab)                          -> approved instantly
//   • Visiting-card photo (outside Punjab)                  -> approved instantly (review later in admin)
//   • Neither                                               -> waits for manual approval

import { db, accountsReady, hashPassword, checkPassword, makeToken, viewerFrom, normPhone, validGstin, GST_STATES } from "../lib/auth.mjs";
import { uploadCard } from "../lib/cloud.mjs";

const STATES = [...new Set(Object.values(GST_STATES))];
const txt = (s, n = 80) => String(s || "").replace(/[<>]/g, "").replace(/\s+/g, " ").trim().slice(0, n);
const out = (data, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const publicUser = u => ({ name: u.name, shop: u.shop, status: u.status });

const MESSAGES = {
  approved: "Welcome! Your account is approved — you can now see all designs.",
  pending: "Thank you! Your account is under review. We usually approve within a day and will WhatsApp you.",
};

export default async (req) => {
  if (req.method !== "POST") return out({ error: "POST only" }, 405);
  if (!accountsReady()) return out({ error: "Accounts are not switched on yet. Please WhatsApp us." }, 503);
  let b = {}; try { b = await req.json(); } catch {}

  if (b.action === "me") {
    const u = await viewerFrom(req);
    return u ? out({ user: publicUser(u) }) : out({ user: null });
  }

  const phone = normPhone(b.phone);
  if (!phone) return out({ error: "Enter a valid 10-digit mobile number." }, 400);

  if (b.action === "login") {
    const rows = await db(`customers?phone=eq.${phone}&select=*`);
    const u = rows[0];
    if (!u || !checkPassword(b.password, u.pass_hash)) { await sleep(700); return out({ error: "Wrong mobile number or password." }, 401); }
    if (u.status === "rejected" || u.status === "blocked") return out({ error: "This account is not active. Please WhatsApp us." }, 403);
    await db(`customers?id=eq.${u.id}`, { method: "PATCH", body: { last_login: new Date().toISOString(), login_count: (u.login_count || 0) + 1 } });
    return out({ token: makeToken(u), user: publicUser(u) });
  }

  if (b.action === "register") {
    const name = txt(b.name, 60), shop = txt(b.shop, 80), city = txt(b.city, 40), state = txt(b.state, 60);
    const password = String(b.password || "");
    if (password.length < 6) return out({ error: "Password must be at least 6 characters." }, 400);
    if (!name || !shop || !city) return out({ error: "Please fill your name, shop name and city." }, 400);
    if (!STATES.includes(state)) return out({ error: "Please choose your state." }, 400);

    let gstin = null;
    if (String(b.gstin || "").trim()) {
      gstin = validGstin(b.gstin);
      if (!gstin) return out({ error: "This GST number doesn't look right. Check it, or leave it empty and add your visiting card." }, 400);
    }
    const card = typeof b.card === "string" && b.card.startsWith("data:image/") ? b.card : null;
    if (card && card.length > 4_000_000) return out({ error: "Visiting card photo is too large." }, 400);

    const existing = await db(`customers?phone=eq.${phone}&select=id`);
    if (existing.length) return out({ error: "This mobile number is already registered. Please log in." }, 409);

    const punjab = state === "Punjab" || (gstin && gstin.startsWith("03"));
    let status = "pending", approval = "manual";
    if (punjab) approval = "punjab-manual";
    else if (gstin) { status = "approved"; approval = "auto-gst"; }
    else if (card) { status = "approved"; approval = "auto-card"; }

    let card_url = null;
    if (card) { try { card_url = await uploadCard(card, phone); } catch (e) { if (status === "approved" && approval === "auto-card") { status = "pending"; approval = "manual"; } } }

    const rows = await db("customers", {
      method: "POST", prefer: "return=representation",
      body: { phone, pass_hash: hashPassword(password), name, shop, city, state, gstin, card_url, status, approval,
              approved_at: status === "approved" ? new Date().toISOString() : null, last_login: new Date().toISOString(), login_count: 1 }
    });
    const u = rows[0];
    return out({ token: makeToken(u), user: publicUser(u), message: MESSAGES[u.status] });
  }

  return out({ error: "Unknown action" }, 400);
};

export const config = { path: "/api/account" };
