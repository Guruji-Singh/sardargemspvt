# Sardar Gems — Temporary Website

Single-page site with a live video grid pulled from the Sardar Jewellery House Instagram via the Instagram API.

## Files
- `index.html` — the site. Edit `CONFIG` at the bottom (Instagram URL, WhatsApp number).
- `netlify/functions/instagram.mjs` — server function that calls Instagram and returns only videos/reels. Keeps the token private.
- `netlify.toml` — Netlify config.

## Setup (one time)

### 1. Instagram account
The Instagram account must be **Business** or **Creator** (Instagram app → Settings → Account type).

### 2. Get an access token
1. Go to developers.facebook.com → My Apps → Create App → type **Business**.
2. Add product **Instagram** → "API setup with Instagram login".
3. Under "Generate access tokens", add the Sardar Jewellery House Instagram account and log in.
4. Copy the generated token (long-lived, valid 60 days). Permission needed: `instagram_business_basic`.

### 3. Deploy on Netlify
1. Drag this folder into app.netlify.com → Add new site → Deploy manually (or connect a Git repo).
2. Site settings → Environment variables → add `INSTAGRAM_TOKEN` = your token.
3. Redeploy. Visit `/api/instagram` to check — you should see a JSON list of videos.
4. Point a domain/subdomain (e.g. `new.sardargems.com`) to it if needed.

## Token refresh (every ~50 days)
Long-lived tokens expire after 60 days. Refresh by opening:

```
https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=CURRENT_TOKEN
```

Copy the new token into `INSTAGRAM_TOKEN` on Netlify and redeploy. If the token expires, the site still works — the video grid shows a "Watch on Instagram" button instead.

## Before going live
- [ ] Set real WhatsApp number in `CONFIG.whatsappNumber`
- [ ] Confirm Instagram handle in `CONFIG.instagramUrl`

## How posts get sorted into categories
Each Instagram post (photo, reel or carousel) is placed in a category when its **caption** contains that category's name or hashtag, e.g. `Sania Bali`, `#saniabali`, `nose pin`, `#nosepin`, `jadau set`, `#mangalsutra`.

- Tip: add one hashtag per item to every new post (e.g. `#nosepin #18k`). It shows up on the site within ~15 minutes.
- To add more matching words, edit the `CATEGORIES` list near the bottom of `index.html`.
- Categories with no matching posts still show, and open WhatsApp directly.
- Each category has a shareable link to send retailers, e.g. `yoursite.com/#c=sania-bali`, `#c=nose-pins`, `#c=jadau-sets`.
