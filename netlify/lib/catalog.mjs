// Shared catalogue rules (used by the server functions).
// Edit the `keys` lists to change which Instagram captions land in which category.

export const PURITIES = ["14K", "16K", "18K", "20K", "22K"];

export const CATEGORIES = [
  { name: "Baby Tops",      keys: ["baby tops", "baby top", "kids tops", "kids earrings"] },
  { name: "Nose Pins",      keys: ["nose pin", "nose pins", "nosepin", "nose ring", "laung", "koka"] },
  { name: "Sania Bali",     keys: ["sania bali", "sania", "saniya"] },
  { name: "Ladies Rings",   keys: ["ladies ring", "ladies rings", "womens ring", "women ring", "girls ring"] },
  { name: "Gents Rings",    keys: ["gents ring", "gents rings", "mens ring", "men ring", "men's ring"] },
  { name: "Rajwadi",        keys: ["rajwadi", "rajwari"] },
  { name: "Fishlock Bali",  keys: ["fishlock", "fish lock"] },
  { name: "Jadau Sets",     keys: ["jadau", "jadu", "kundan"] },
  { name: "Pendant Sets",   keys: ["pendant set", "pendant sets", "pendant"] },
  { name: "Mangalsutra",    keys: ["mangalsutra", "mangalsutar", "mangal sutra"] },
  { name: "Marathi Nath",   keys: ["marathi nath", "nath"] },
  { name: "Pipe Bali",      keys: ["pipe bali", "pipebali"] },
  { name: "Cocktail Rings", keys: ["cocktail ring", "cocktail rings", "cocktail"] },
  { name: "2-in-1 Studs",   keys: ["2 in 1", "2in1", "two in one"] },
  { name: "Other Designs",  keys: [] }     // uploads marked "Other" and media/latest
].map(c => ({ ...c, slug: slugify(c.name) }));

export function slugify(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); }

const norm = t => (t || "").toLowerCase().replace(/[#_\-.,!|/]+/g, " ").replace(/\s+/g, " ");

export function categoriesFromCaption(caption) {
  const spaced = " " + norm(caption) + " ";
  const joined = spaced.replace(/ /g, "");
  return CATEGORIES.filter(c => c.keys.some(k => {
    const kk = norm(k).trim();
    if (spaced.includes(" " + kk + " ") || spaced.includes(" " + kk + "s ")) return true;
    const kj = kk.replace(/ /g, "");
    return kj.length >= 6 && joined.includes(kj);          // hashtags like #saniabali
  })).map(c => c.slug);
}

export function purityFromCaption(t) {
  return PURITIES.filter(p => new RegExp("(^|[^0-9])" + p.slice(0, 2) + "\\s*(k|kt|karat|carat)\\b", "i").test(t || ""));
}

/** Map an upload/folder slug to a category slug ("latest"/"other" -> other-designs). */
export function catFromSlug(s) {
  const c = CATEGORIES.find(x => x.slug === s);
  if (c) return c.slug;
  return "other-designs";
}
