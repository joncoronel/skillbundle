import { internalAction } from "./_generated/server";
import { v } from "convex/values";
import { fetchRepoMetadata } from "./lib/github";

// ---------------------------------------------------------------------------
// URL parsing
// ---------------------------------------------------------------------------

function parseGitHubUrl(url: string): { owner: string; repo: string } | null {
  // Strip trailing slashes, .git suffix, and fragment/query
  let cleaned = url.trim().replace(/\/+$/, "").replace(/\.git$/, "");
  cleaned = cleaned.split("?")[0].split("#")[0];

  // Match github.com/owner/repo (with or without protocol)
  const match = cleaned.match(
    /(?:https?:\/\/)?(?:www\.)?github\.com\/([^/]+)\/([^/]+)/,
  );
  if (!match) return null;

  return { owner: match[1], repo: match[2] };
}

// ---------------------------------------------------------------------------
// Repo fingerprint — semantic signals about a repo's tech stack
// ---------------------------------------------------------------------------

export interface RepoFingerprint {
  /** Raw dependency package names from package.json + non-JS manifests. */
  packages: string[];
  /** Config file basenames present in the repo root (e.g. drizzle.config.ts). */
  configFiles: string[];
  /** Detected language ecosystems (python, rust, go, etc.). */
  languages: string[];
  /** GitHub repo description. */
  description?: string;
  /** GitHub repo topics. */
  topics: string[];
  /** First ~1500 chars of the README. */
  readmeExcerpt?: string;
}

const README_EXCERPT_LIMIT = 1500;

const README_CANDIDATES = ["README.md", "readme.md", "README.MD", "Readme.md"];

const NON_JS_DEPENDENCY_FILES = [
  "requirements.txt",
  "pyproject.toml",
  "Cargo.toml",
  "go.mod",
  "Dockerfile",
] as const;

const FILE_LANGUAGE_MAP: Record<string, string> = {
  "requirements.txt": "python",
  "pyproject.toml": "python",
  "Cargo.toml": "rust",
  "go.mod": "go",
  "Dockerfile": "docker",
};

/** Common config files we look for in the repo root as fingerprint signals. */
const KNOWN_CONFIG_FILES = [
  "next.config.js",
  "next.config.ts",
  "next.config.mjs",
  "nuxt.config.ts",
  "nuxt.config.js",
  "svelte.config.js",
  "svelte.config.ts",
  "angular.json",
  "vite.config.ts",
  "vite.config.js",
  "tailwind.config.js",
  "tailwind.config.ts",
  "drizzle.config.ts",
  "drizzle.config.js",
  "prisma/schema.prisma",
  "convex/schema.ts",
  "tsconfig.json",
  "tailwind.config.cjs",
  "postcss.config.js",
  "playwright.config.ts",
  "vitest.config.ts",
  "jest.config.js",
  "jest.config.ts",
  "astro.config.mjs",
  "remix.config.js",
  "wrangler.toml",
  "fly.toml",
  "Dockerfile",
  "docker-compose.yml",
  "supabase/config.toml",
];

interface PackageJson {
  name?: string;
  description?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

async function fetchRawFile(
  owner: string,
  repo: string,
  branch: string,
  path: string,
): Promise<string | null> {
  const url = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

async function fetchPackageJson(
  owner: string,
  repo: string,
  branch: string,
): Promise<PackageJson | null> {
  const text = await fetchRawFile(owner, repo, branch, "package.json");
  if (!text) return null;
  try {
    return JSON.parse(text) as PackageJson;
  } catch {
    return null;
  }
}

async function fetchReadmeExcerpt(
  owner: string,
  repo: string,
  branch: string,
): Promise<string | null> {
  for (const candidate of README_CANDIDATES) {
    const text = await fetchRawFile(owner, repo, branch, candidate);
    if (text) {
      return text.slice(0, README_EXCERPT_LIMIT);
    }
  }
  return null;
}

/** Parse a non-JS dependency file and extract package names (best-effort). */
function parseNonJsPackages(filename: string, content: string): string[] {
  const pkgs = new Set<string>();
  switch (filename) {
    case "requirements.txt": {
      for (const line of content.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("-"))
          continue;
        const pkgName = trimmed.split(/[=<>!~\[;@\s]/)[0];
        if (pkgName) pkgs.add(pkgName.toLowerCase());
      }
      break;
    }
    case "pyproject.toml": {
      const depsMatch = content.match(/dependencies\s*=\s*\[([\s\S]*?)\]/);
      if (depsMatch) {
        const matches = depsMatch[1].matchAll(/["']([a-zA-Z0-9_-]+)/g);
        for (const m of matches) pkgs.add(m[1].toLowerCase());
      }
      break;
    }
    case "Cargo.toml": {
      const depsMatch = content.match(
        /\[(?:dev-)?dependencies\]([\s\S]*?)(?=\n\[|\s*$)/g,
      );
      if (depsMatch) {
        for (const section of depsMatch) {
          for (const line of section.split("\n")) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("["))
              continue;
            const crate = trimmed.split(/[\s=]/)[0];
            if (crate) pkgs.add(crate);
          }
        }
      }
      break;
    }
    case "go.mod": {
      const requireMatch = content.match(/require\s*\(([\s\S]*?)\)/g);
      if (requireMatch) {
        for (const block of requireMatch) {
          for (const line of block.split("\n")) {
            const trimmed = line.trim();
            if (
              !trimmed ||
              trimmed.startsWith("//") ||
              trimmed.startsWith("require") ||
              trimmed === ")"
            )
              continue;
            const modulePath = trimmed.split(/\s/)[0];
            if (modulePath) pkgs.add(modulePath);
          }
        }
      }
      const singleRequires = content.matchAll(/^require\s+(\S+)\s/gm);
      for (const m of singleRequires) pkgs.add(m[1]);
      break;
    }
  }
  return Array.from(pkgs);
}

/**
 * Build a repo fingerprint by fetching package.json + non-JS manifests +
 * GitHub metadata (description/topics) + README excerpt. Tries main and
 * master branches. Returns null if nothing useful was found.
 */
export async function buildRepoFingerprint(
  owner: string,
  repo: string,
): Promise<{ fingerprint: RepoFingerprint; branch: string } | null> {
  // Fetch repo metadata + dependency files in parallel
  const metaPromise = fetchRepoMetadata(owner, repo);

  // Try the metadata's default branch first; fall back to main/master
  const meta = await metaPromise;
  const branchesToTry: string[] = [];
  if (meta?.defaultBranch) branchesToTry.push(meta.defaultBranch);
  if (!branchesToTry.includes("main")) branchesToTry.push("main");
  if (!branchesToTry.includes("master")) branchesToTry.push("master");

  let foundBranch: string | null = null;
  let pkgJson: PackageJson | null = null;
  const nonJsContents = new Map<string, string>();

  for (const branch of branchesToTry) {
    const [pkg, ...nonJs] = await Promise.all([
      fetchPackageJson(owner, repo, branch),
      ...NON_JS_DEPENDENCY_FILES.map((f) => fetchRawFile(owner, repo, branch, f)),
    ]);

    const anyNonJs = nonJs.some((c) => c !== null);
    if (pkg || anyNonJs) {
      pkgJson = pkg;
      for (let i = 0; i < NON_JS_DEPENDENCY_FILES.length; i++) {
        if (nonJs[i]) nonJsContents.set(NON_JS_DEPENDENCY_FILES[i], nonJs[i]!);
      }
      foundBranch = branch;
      break;
    }
  }

  // Even with no dependency files, we still have GitHub metadata + README —
  // that's enough for an embedding-based recommendation.
  const branch = foundBranch ?? meta?.defaultBranch ?? "main";

  const readmeExcerpt = await fetchReadmeExcerpt(owner, repo, branch);

  if (
    !pkgJson &&
    nonJsContents.size === 0 &&
    !readmeExcerpt &&
    !meta?.description &&
    (!meta?.topics || meta.topics.length === 0)
  ) {
    return null;
  }

  // Extract packages
  const packages = new Set<string>();
  if (pkgJson) {
    const deps = {
      ...(pkgJson.dependencies ?? {}),
      ...(pkgJson.devDependencies ?? {}),
    };
    for (const name of Object.keys(deps)) packages.add(name);
  }
  for (const [filename, content] of nonJsContents) {
    for (const pkg of parseNonJsPackages(filename, content)) packages.add(pkg);
  }

  // Detect languages
  const languages = new Set<string>();
  if (pkgJson) languages.add("javascript");
  for (const filename of nonJsContents.keys()) {
    const lang = FILE_LANGUAGE_MAP[filename];
    if (lang) languages.add(lang);
  }

  // Detect config files (best-effort: HEAD requests in parallel)
  const configChecks = await Promise.all(
    KNOWN_CONFIG_FILES.map(async (path) => {
      try {
        const res = await fetch(
          `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path}`,
          { method: "HEAD" },
        );
        return res.ok ? path : null;
      } catch {
        return null;
      }
    }),
  );
  const configFiles = configChecks.filter((c): c is string => c !== null);

  return {
    branch,
    fingerprint: {
      packages: Array.from(packages),
      configFiles,
      languages: Array.from(languages),
      description: meta?.description ?? undefined,
      topics: meta?.topics ?? [],
      readmeExcerpt: readmeExcerpt ?? undefined,
    },
  };
}

/** Build the embedding-input string from a fingerprint. */
export function fingerprintToEmbeddingInput(
  fingerprint: RepoFingerprint,
): string {
  const parts: string[] = [];
  if (fingerprint.description) parts.push(fingerprint.description);
  if (fingerprint.topics.length > 0) {
    parts.push(`Topics: ${fingerprint.topics.join(", ")}`);
  }
  if (fingerprint.languages.length > 0) {
    parts.push(`Languages: ${fingerprint.languages.join(", ")}`);
  }
  if (fingerprint.packages.length > 0) {
    parts.push(`Dependencies: ${fingerprint.packages.join(", ")}`);
  }
  if (fingerprint.configFiles.length > 0) {
    parts.push(`Config files: ${fingerprint.configFiles.join(", ")}`);
  }
  if (fingerprint.readmeExcerpt) {
    parts.push(fingerprint.readmeExcerpt);
  }
  return parts.join("\n\n");
}

/**
 * Internal action that builds a fingerprint for a parsed repo. Used by
 * recommendations.ts (which has the public action with rate limiting + caching).
 */
export const buildFingerprintForRepo = internalAction({
  args: { owner: v.string(), repo: v.string() },
  handler: async (_ctx, { owner, repo }): Promise<{
    fingerprint: RepoFingerprint;
    branch: string;
  } | null> => {
    return await buildRepoFingerprint(owner, repo);
  },
});

export { parseGitHubUrl };
