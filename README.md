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

## Settings
- WhatsApp: 919877313252 · Instagram: @sardar_jewellery_house (edit in `CONFIG` in `index.html`)

## How posts get sorted into categories
Each Instagram post (photo, reel or carousel) is placed in a category when its **caption** contains that category's name or hashtag, e.g. `Sania Bali`, `#saniabali`, `nose pin`, `#nosepin`, `jadau set`, `#mangalsutra`.

- Tip: add one hashtag per item to every new post (e.g. `#nosepin #18k`). It shows up on the site within ~15 minutes.
- To add more matching words, edit the `CATEGORIES` list near the bottom of `index.html`.
- Categories with no matching posts still show, and open WhatsApp directly.
- Each category has a shareable link to send retailers, e.g. `yoursite.com/#c=sania-bali`, `#c=nose-pins`, `#c=jadau-sets`.

## Adding your own photos/videos (without Instagram)
1. On GitHub open the `media` folder, then the category folder (e.g. `media/nose-pins`). Use `media/latest` for items with no category.
2. Click **Add file → Upload files**, drag in photos (.jpg/.png) or videos (.mp4), click **Commit changes**.
3. Netlify redeploys automatically; the files appear on the site in ~1 minute. Files in `media/latest` show under "Other Designs".
- Limit: 25 MB per file via the GitHub website. Compress big videos first (WhatsApp-sending a video to yourself and saving it works).
- Use .mp4 for videos (iPhone .mov may not play in Chrome).
- To remove: open the file on GitHub → ⋯ → Delete file → Commit.
- Video cover: upload a photo with the same name as the video (e.g. `ring.mp4` + `ring.jpg`); it becomes the video's cover and isn't shown separately. Recommended — some phones show a blank tile for videos without a cover.

## Admin upload page (sardargems.com/admin)
Upload product photos/videos straight from your phone. Files are stored on Cloudinary and appear on the site within ~1 minute, labelled with a product code (e.g. "Ladies Ring 004"); customers get an "Ask about Ladies Ring 004 on WhatsApp" button.

**One-time setup** — Netlify → Project configuration → Environment variables, add (tick "Contains secret values"):
- `ADMIN_PASSWORD` — the password for the upload page
- `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` — from Cloudinary → Settings → API Keys
Then Deploys → Trigger deploy.

Tips: add the page to your phone's home screen (browser menu → Add to Home screen). Keep clips 2–3 s, phone held upright, plain background, good light. Limits: video 100 MB, photo 10 MB.


## Retailer accounts (guest limit + approvals)
- Guests (and accounts waiting for approval) see the **first 10 designs of each collection**; approved retailers see everything. Enforced on the server (`/api/feed`), not just hidden on the page.
- Sign-up: mobile + password, name, shop, city, state, optional GST number, optional visiting-card photo.
- Approval rules: **Punjab** (state or GSTIN starting 03) → always manual · valid GSTIN → instant · visiting card → instant (check it later in admin) · neither → manual.
- GST numbers are checked for correct format and check-digit only — not against the government register.
- Approve / reject / block / reset passwords at **sardargems.com/admin → Customers**. Blocking or resetting a password logs that retailer out immediately.
- Accounts are stored in Supabase project **sardar-customers** (Mumbai). Visiting-card photos are in Cloudinary folder `sardar-cards`.

**One-time setup:** Netlify → Environment variables → add `SUPABASE_SERVICE_KEY` (Supabase → project *sardar-customers* → Project Settings → API Keys → **Secret key**; tick "Contains secret values"), then Trigger deploy. Until it's set, the site shows every design to everyone and the Login button is hidden.

## What's on the site
- Hero: latest Instagram **product** reels (posts whose caption names a collection). Greetings/promos are never shown.
- Collections: only collections that have designs, plus a "More on request" card.
- All designs: one feed with collection, type and purity filters.
