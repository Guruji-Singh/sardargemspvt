// Every 10 minutes: send new billing-software photos/videos to Cloudinary, so a video
// added in the billing app reaches the website without anyone having to open the site.
import { stockItemsAndCopy } from "../lib/elysian.mjs";

export default async () => {
  try {
    const r = await stockItemsAndCopy(null);
    console.log("sync-stock", JSON.stringify({ shown: r.items.length, queued: r.queued, waiting: r.waiting }));
  } catch (e) { console.warn("sync-stock", e.message); }
  return new Response("ok");
};

export const config = { schedule: "*/10 * * * *" };
