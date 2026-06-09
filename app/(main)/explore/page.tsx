import { ExploreContent } from "./explore-content";

export default async function ExplorePage() {
  // Render dynamically so ExploreContent's search params (nuqs) resolve on the
  // server — the full page ships in the initial HTML instead of bailing to
  // client rendering behind a Suspense fallback (which flashes empty on load).

  return (
    <main className="mx-auto max-w-5xl px-4 pt-12 pb-20">
      <header>
        <h1 className="font-display text-[clamp(2.5rem,5vw,4rem)] font-semibold tracking-tight leading-hero text-balance">
          Explore.
        </h1>
        <p className="mt-3 max-w-prose text-sm text-muted-foreground">
          What the community is building, right now.
        </p>
      </header>

      <div className="mt-10 space-y-14">
        <ExploreContent />
      </div>
    </main>
  );
}
