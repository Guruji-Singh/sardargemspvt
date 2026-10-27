// Runs on Netlify at every deploy. Scans the media/ folder and writes netlify/lib/media-list.mjs,
// which the feed function uses (so guests only see the first designs of each category).
//
//   media/nose-pins/anything.jpg   -> shows under "Nose Pins"
//   media/latest/anything.mp4      -> shows under "Other Designs"
//
// Newest files first: name files so they sort that way (e.g. 2026-10-27-ring.jpg), or
// leave them; files are ordered by name, Z→A / newest date first.

import { readdirSync, statSync, writeFileSync, existsSync } from "node:fs";
import { join, extname } from "node:path";

const ROOT = "media";
const IMG = [".jpg", ".jpeg", ".png", ".webp", ".gif"];
const VID = [".mp4", ".webm", ".mov", ".m4v"];

const items = [];
if (existsSync(ROOT)) {
  for (const folder of readdirSync(ROOT)) {
    const dir = join(ROOT, folder);
    if (!statSync(dir).isDirectory()) continue;
    const files = readdirSync(dir).filter(f => !f.startsWith(".")).sort().reverse();
    const url = f => `${ROOT}/${encodeURIComponent(folder)}/${encodeURIComponent(f)}`;
    const base = f => f.slice(0, f.length - extname(f).length).toLowerCase();
    // A photo with the same name as a video (ring.mp4 + ring.jpg) becomes that video's cover image.
    const videoBases = new Set(files.filter(f => VID.includes(extname(f).toLowerCase())).map(base));
    const posterFor = {};
    files.forEach(f => { if (IMG.includes(extname(f).toLowerCase()) && videoBases.has(base(f))) posterFor[base(f)] = url(f); });
    for (const f of files) {
      const ext = extname(f).toLowerCase();
      const type = IMG.includes(ext) ? "image" : VID.includes(ext) ? "video" : null;
      if (!type) continue;
      if (type === "image" && videoBases.has(base(f))) continue;   // used as a cover, not shown separately
      const src = url(f);
      items.push({
        id: `own_${folder}_${f}`,
        type,
        src,
        thumbnail: type === "image" ? src : (posterFor[base(f)] || ""),
        caption: "",
        permalink: "",
        folder: folder.toLowerCase()
      });
    }
  }
}

writeFileSync("netlify/lib/media-list.mjs", "// Generated at deploy by scripts/build-media.mjs — do not edit.\nexport default " + JSON.stringify(items, null, 1) + ";\n");
console.log(`media-list: ${items.length} file(s)`);
