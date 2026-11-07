import handler from "../../netlify/functions/feed.mjs";
import { wrap } from "../../netlify/lib/cf-wrap.mjs";
export const onRequest = wrap(handler);
