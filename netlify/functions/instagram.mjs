// Netlify Function: fetches photo and video posts from the Instagram account.
// Keeps the access token on the server (set INSTAGRAM_TOKEN in Netlify → Site settings → Environment variables).

const FIELDS = "id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,children{media_type,media_url,thumbnail_url}";
const MAX_ITEMS = 150;
const MAX_PAGES = 6;

export default async () => {
  const token = process.env.INSTAGRAM_TOKEN;
  if (!token) return Response.json({ error: "INSTAGRAM_TOKEN not set" }, { status: 500 });

  let url = `https://graph.instagram.com/v21.0/me/media?fields=${FIELDS}&limit=50&access_token=${token}`;
  const items = [];

  try {
    for (let page = 0; url && page < MAX_PAGES && items.length < MAX_ITEMS; page++) {
      const res = await fetch(url);
      const json = await res.json();
      if (json.error) return Response.json({ error: json.error.message }, { status: 502 });

      for (const m of json.data || []) {
        // A carousel becomes one item per slide, all sharing the post's caption and link.
        const slides = m.media_type === "CAROUSEL_ALBUM" ? (m.children?.data || []) : [m];
        slides.forEach((s, i) => {
          const isVideo = s.media_type === "VIDEO";
          items.push({
            id: `${m.id}_${i}`,
            type: isVideo ? "video" : "image",
            src: s.media_url,
            thumbnail: isVideo ? (s.thumbnail_url || "") : s.media_url,
            caption: m.caption || "",
            permalink: m.permalink,
            timestamp: m.timestamp
          });
        });
      }
      url = json.paging?.next;
    }
  } catch (e) {
    return Response.json({ error: e.message }, { status: 502 });
  }

  return Response.json(
    { items: items.slice(0, MAX_ITEMS) },
    // Instagram media URLs are signed and expire, so cache only 15 min at the edge.
    { headers: { "Cache-Control": "public, max-age=0", "Netlify-CDN-Cache-Control": "public, s-maxage=900, stale-while-revalidate=300" } }
  );
};

export const config = { path: "/api/instagram" };
