import handler from "../../netlify/functions/admin.mjs";
import { wrap } from "../../netlify/lib/cf-wrap.mjs";
export const onRequest = wrap(handler);
