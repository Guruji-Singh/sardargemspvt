// /api/img?u=<image url> — serves a product photo from our own domain so the
// cart's catalogue PDF can draw it. Only our known photo hosts are allowed.
const ALLOWED = [/\.cloudinary\.com$/, /\.cdninstagram\.com$/, /\.fbcdn\.net$/, /^office\.sardargems\.com$/, /^(www\.|new\.)?sardargems\.com$/];

export default async (request) => {
  let target;
  try { target = new URL(new URL(request.url).searchParams.get("u") || ""); } catch (e) { target = null; }
  if (!target || target.protocol !== "https:" || !ALLOWED.some(r => r.test(target.hostname)))
    return Response.json({ error: "Image address not allowed" }, { status: 400 });
  const r = await fetch(target.toString(), { headers: { Accept: "image/jpeg,image/png,image/*" } });
  const type = r.headers.get("content-type") || "";
  if (!r.ok || !type.startsWith("image/")) return Response.json({ error: "Image not found" }, { status: 404 });
  return new Response(r.body, { headers: { "Content-Type": type, "Cache-Control": "public, max-age=86400" } });
};
