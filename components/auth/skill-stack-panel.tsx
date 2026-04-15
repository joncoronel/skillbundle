type Skill = { name: string; kind: string };

const SKILLS: Skill[] = [
  { name: "next.js", kind: "framework" },
  { name: "react", kind: "framework" },
  { name: "convex", kind: "backend" },
  { name: "clerk", kind: "auth" },
  { name: "tailwind", kind: "styling" },
  { name: "typescript", kind: "language" },
  { name: "motion", kind: "animation" },
  { name: "radix", kind: "primitives" },
  { name: "prisma", kind: "orm" },
  { name: "drizzle", kind: "orm" },
  { name: "zod", kind: "validation" },
  { name: "trpc", kind: "rpc" },
  { name: "supabase", kind: "backend" },
  { name: "vercel", kind: "hosting" },
  { name: "postgres", kind: "db" },
  { name: "redis", kind: "cache" },
  { name: "stripe", kind: "payments" },
  { name: "sentry", kind: "observability" },
  { name: "playwright", kind: "testing" },
  { name: "vitest", kind: "testing" },
  { name: "storybook", kind: "docs" },
  { name: "shadcn", kind: "components" },
];

// Three copies so there's always ≥2 copies worth of content below the viewport,
// even when the container is taller than one copy. Paired with
// translateY(-33.333%) in the `scroll-stack` keyframe for a seamless loop.
const LOOP: Skill[] = [...SKILLS, ...SKILLS, ...SKILLS];

export function SkillStackPanel() {
  return (
    <aside
      aria-hidden="true"
      className="relative hidden overflow-hidden border-l border-border bg-[oklch(from_var(--primary)_l_c_h/3%)] lg:col-start-2 lg:flex"
    >
      <div className="sticky top-0 flex h-screen w-full flex-col">
        <div className="border-b border-border px-10 py-5 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          <span>{"// popular in the stack"}</span>
        </div>

        <div
          className="group relative flex-1 overflow-hidden"
          style={{
            maskImage:
              "linear-gradient(to bottom, transparent 0, black 96px, black calc(100% - 96px), transparent 100%)",
            WebkitMaskImage:
              "linear-gradient(to bottom, transparent 0, black 96px, black calc(100% - 96px), transparent 100%)",
          }}
        >
          <ul className="flex flex-col animate-scroll-stack motion-reduce:animate-none group-hover:[animation-play-state:paused] will-change-transform">
            {LOOP.map((skill, i) => (
              <li
                key={`${skill.name}-${i}`}
                className="flex items-baseline gap-6 px-10 py-3 font-mono text-sm text-foreground/80"
              >
                <span className="w-6 text-[10px] tabular-nums text-muted-foreground">
                  {((i % SKILLS.length) + 1).toString().padStart(2, "0")}
                </span>
                <span className="flex-1 truncate">{skill.name}</span>
                <span className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                  {skill.kind}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </aside>
  );
}
