// Catalogue PDFs on the website.
//   Guests and accounts awaiting approval get the preview PDF (first page of designs).
//   Approved retailers get the full branded PDF.
//
//   POST /api/catalogue { name: <catalogue slug> }  (Authorization: Bearer <login token>)
//        -> { url }      link to the full PDF, valid for 10 minutes   (approved retailers)
//        -> { preview }  link to the preview                          (everyone else)
//   GET  /api/catalogue?preview=<slug>               -> the preview PDF
//   GET  /api/catalogue?file=…&name=…&e=…&s=…        -> a signed link to a PDF kept in Cloudinary (older catalogues)
//
// New catalogues keep their PDFs on Hostinger (sjh-website/files.php); links to those go straight there.

import { viewerFrom, accountsReady } from "../lib/auth.mjs";
import { getCatalogue, downloadUrl, checkPdfLink, pdfUrl, isHost } from "../lib/catalogues.mjs";

const out = (data, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "no-store" } });

async function published(slug) {
  const c = await getCatalogue(String(slug || "")).catch(() => null);
  return c && c.status === "published" ? c : null;
}

/** Stream a PDF kept in Cloudinary (older catalogues). */
async function streamCloudinary(publicId, title, download = false) {
  const r = await fetch(downloadUrl(publicId, 5));
  if (!r.ok) return new Response("Catalogue not available", { status: 502 });
  return new Response(r.body, { headers: {
    "Content-Type": "application/pdf",
    "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${title.replace(/"/g, "")}"`,
    "Cache-Control": "private, no-store",
    "X-Robots-Tag": "noindex"
  } });
}

const previewLink = c => c.preview ? `/api/catalogue?preview=${encodeURIComponent(c.slug)}` : "/#catalogues";

export default async (req) => {
  const url = new URL(req.url);

  if (req.method === "POST") {
    let body = {}; try { body = await req.json(); } catch {}
    const c = await published(body.name);
    if (!c) return out({ error: "Unknown catalogue" }, 404);
    const viewer = await viewerFrom(req);
    const full = accountsReady() && viewer && viewer.status === "approved";
    if (!full || !c.branded) return out({ preview: previewLink(c), reason: viewer ? (full ? "not-ready" : "pending") : "guest" });
    return out({ url: pdfUrl(c.branded, `Sardar Gems - ${c.name}.pdf`) });
  }

  if (url.searchParams.has("file")) {                       // signed link to a Cloudinary PDF (10 minutes)
    const f = checkPdfLink(url.searchParams);
    if (!f) return new Response("This link has expired. Go back and tap the button again.", { status: 403 });
    return streamCloudinary(f.id, f.name, true);
  }

  const previewSlug = url.searchParams.get("preview");
  if (previewSlug) {
    const c = await published(previewSlug);
    if (!c || !c.preview) return Response.redirect(new URL("/#catalogues", url.origin), 302);
    const title = `Sardar Gems - ${c.name} (preview).pdf`;
    if (isHost(c.preview)) return Response.redirect(pdfUrl(c.preview, title), 302);
    return streamCloudinary(c.preview, title);
  }

  return Response.redirect(new URL("/#catalogues", url.origin), 302);
};

export const config = { path: "/api/catalogue" };
