// Retired: the product list is no longer public (guests may only see the first designs of each category).
// The website uses /api/feed and the admin page uses /api/admin { action: "list" }.
export default async () => Response.json({ error: "Moved to /api/feed" }, { status: 410 });
export const config = { path: "/api/products" };
