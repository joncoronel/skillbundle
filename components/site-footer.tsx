import Link from "next/link";
import { LogoMark } from "@/components/brand-mark";
import { SUPPORT_EMAIL } from "@/lib/legal";

/**
 * The site footer, mounted once from `app/(main)/layout.tsx`.
 *
 * A Server Component with no client state, so its links ship in every route's
 * prerendered HTML and stay crawlable. That matters: Clerk, Polar and Google's
 * OAuth verification all expect the legal pages to be reachable from the site
 * root, not merely to resolve when typed.
 *
 * `pb-28` is not spacing taste. `GlobalBundleBar` floats at `bottom-4` on browse
 * routes, so a flush footer puts its last row under the bar whenever a selection
 * is active. Shrink the pad and the legal links stop being clickable.
 */

const PRODUCT_LINKS = [
  { href: "/official", label: "Official" },
  { href: "/add", label: "Add skill" },
  { href: "/compare", label: "Compare" },
  { href: "/pricing", label: "Pricing" },
];

const LEGAL_LINKS = [
  { href: "/privacy", label: "Privacy" },
  { href: "/terms", label: "Terms" },
];

function FooterColumn({
  heading,
  links,
}: {
  heading: string;
  links: { href: string; label: string }[];
}) {
  return (
    <div>
      <h2 className="text-(length:--text-micro) font-medium tracking-wide text-muted-foreground uppercase">
        {heading}
      </h2>
      <ul className="mt-3 flex flex-col gap-2">
        {links.map((link) => (
          <li key={link.href}>
            <Link
              href={link.href}
              className="text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function SiteFooter() {
  return (
    <footer className="mt-24 border-t border-border">
      <div className="mx-auto max-w-6xl px-4 pt-12 pb-28">
        <div className="flex flex-col gap-10 sm:flex-row sm:justify-between">
          <div className="max-w-xs">
            <Link
              href="/"
              className="inline-flex items-center gap-2 text-foreground"
            >
              <LogoMark className="h-[18px]" />
              <span className="text-sm font-semibold">SkillBundle</span>
            </Link>
            <p className="mt-3 text-sm text-muted-foreground">
              Find AI coding assistant skills, watch the ones you depend on, and
              see what changed.
            </p>
          </div>

          <div className="flex gap-12 sm:gap-16">
            <FooterColumn heading="Product" links={PRODUCT_LINKS} />
            <FooterColumn heading="Legal" links={LEGAL_LINKS} />
            <div>
              <h2 className="text-(length:--text-micro) font-medium tracking-wide text-muted-foreground uppercase">
                Contact
              </h2>
              <ul className="mt-3 flex flex-col gap-2">
                <li>
                  <a
                    href={`mailto:${SUPPORT_EMAIL}`}
                    className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                  >
                    Support
                  </a>
                </li>
                <li>
                  <a
                    href="https://github.com/joncoronel/skillbundle"
                    className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                    rel="noreferrer"
                  >
                    GitHub
                  </a>
                </li>
              </ul>
            </div>
          </div>
        </div>

        <div className="mt-12 flex flex-col gap-2 border-t border-border pt-6 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          {/* Literal, not `new Date().getFullYear()`: reading the clock is
              uncached dynamic IO under Cache Components, and this renders in the
              (main) layout, so it would pull every route out of its static
              shell. Bump it by hand each January. */}
          <p>© 2026 SkillBundle</p>
          <p>
            Skill metadata from{" "}
            <a
              href="https://skills.sh"
              className="underline underline-offset-2 transition-colors hover:text-foreground"
              rel="noreferrer"
            >
              skills.sh
            </a>{" "}
            and public GitHub repositories.
          </p>
        </div>
      </div>
    </footer>
  );
}
