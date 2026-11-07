import handler from "../../netlify/functions/catalogue.mjs";
import { wrap } from "../../netlify/lib/cf-wrap.mjs";
export const onRequest = wrap(handler);
