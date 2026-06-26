import { bundleOgImage } from "@/lib/og/images";

// Bundle OG image, cached per (id, version). The version (`v` = the bundle's
// updatedAt) lives in the PATH, not a query string, so each version is its own
// cacheable route: it renders once on first request and is served from cache on
// every subsequent unfurl — no function run, no Convex read. Editing the bundle
// bumps updatedAt → a new path → exactly one fresh render. `v` is only a cache
// key; the image is built from the live bundle looked up by `id`.
//
// Versioning the URL (rather than busting a stable URL) is what makes SOCIAL
// platforms re-fetch too — they cache the unfurl image by URL for days.

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; v: string }> },
) {
  const { id, v } = await params;
  return bundleOgImage(id, v);
}
