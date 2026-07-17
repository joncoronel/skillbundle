import type { TreeEntry } from "./lib/github";
import { extractRepoSlug } from "../lib/repo-match";

// ---------------------------------------------------------------------------
// URL parsing
// ---------------------------------------------------------------------------

// Delegate to the canonical parser (lib/repo-match) so the server, the demo
// allowlist, and the composer's validation stay in lockstep. It accepts full
// URLs and bare `owner/repo` slugs with a case-insensitive host.
const parseGitHubUrl = extractRepoSlug;

// ---------------------------------------------------------------------------
// Repo fingerprint — semantic signals about a repo's tech stack
// ---------------------------------------------------------------------------

export interface RepoFingerprint {
  /** Raw dependency package names from package.json + non-JS manifests. */
  packages: string[];
  /** Config file paths present in the repo (e.g. prisma/schema.prisma). */
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

const FILE_LANGUAGE_MAP: Record<string, string> = {
  "requirements.txt": "python",
  "pyproject.toml": "python",
  "Cargo.toml": "rust",
  "go.mod": "go",
  "Dockerfile": "docker",
};

/** Config file paths whose presence in the repo tree is a fingerprint signal. */
const KNOWN_CONFIG_FILES = new Set([
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
]);

/** Directories that should never contain relevant package.json files. */
const EXCLUDED_SEGMENTS = [
  "node_modules",
  "test/fixtures",
  "__fixtures__",
  "__tests__",
  ".next",
  "dist",
  "build",
  "examples",
  ".cache",
  "coverage",
];

/** Check if a tree path is a relevant workspace package.json to analyze. */
function isRelevantPackageJson(path: string): boolean {
  if (!path.endsWith("package.json")) return false;
  if (path === "package.json") return false; // root is handled separately
  const lowerPath = path.toLowerCase();
  return !EXCLUDED_SEGMENTS.some((seg) => lowerPath.includes(seg));
}

const MAX_WORKSPACE_PACKAGE_JSONS = 15;

// ---------------------------------------------------------------------------
// Raw file fetching (via raw.githubusercontent.com — free, no API quota)
// ---------------------------------------------------------------------------

interface PackageJson {
  name?: string;
  description?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

export async function fetchRawFile(
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

function parsePackageJson(text: string): PackageJson | null {
  try {
    return JSON.parse(text) as PackageJson;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Non-JS dependency file parsing
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Tree scanning
// ---------------------------------------------------------------------------

const README_CANDIDATES = new Set([
  "README.md",
  "readme.md",
  "README.MD",
  "Readme.md",
]);

const DEP_FILES = new Set([
  "package.json",
  "requirements.txt",
  "pyproject.toml",
  "Cargo.toml",
  "go.mod",
  "Dockerfile",
]);

export interface TreeScanResult {
  configFiles: string[];
  workspacePackageJsonPaths: string[];
  /** Which root dep files actually exist in the tree. */
  depFiles: string[];
  /** First matching README variant, or null. */
  readmePath: string | null;
}

/**
 * Single-pass scan over tree entries. Extracts config files, workspace
 * package.json paths, which root dep files exist, and the README path.
 */
export function scanTree(entries: TreeEntry[]): TreeScanResult {
  const configFiles: string[] = [];
  const workspacePaths: string[] = [];
  const depFiles: string[] = [];
  let readmePath: string | null = null;

  for (const entry of entries) {
    if (entry.type !== "blob") continue;

    if (KNOWN_CONFIG_FILES.has(entry.path)) {
      configFiles.push(entry.path);
    }
    if (isRelevantPackageJson(entry.path)) {
      workspacePaths.push(entry.path);
    }
    // Root-level dep files (no slash in path = root)
    if (!entry.path.includes("/") && DEP_FILES.has(entry.path)) {
      depFiles.push(entry.path);
    }
    // First matching README at root
    if (!readmePath && !entry.path.includes("/") && README_CANDIDATES.has(entry.path)) {
      readmePath = entry.path;
    }
  }

  // Sort workspace paths: shallower first, then alphabetical. Cap count.
  workspacePaths.sort((a, b) => {
    const depthA = a.split("/").length;
    const depthB = b.split("/").length;
    return depthA !== depthB ? depthA - depthB : a.localeCompare(b);
  });

  return {
    configFiles,
    workspacePackageJsonPaths: workspacePaths.slice(
      0,
      MAX_WORKSPACE_PACKAGE_JSONS,
    ),
    depFiles,
    readmePath,
  };
}

// ---------------------------------------------------------------------------
// Fingerprint builder
// ---------------------------------------------------------------------------

interface BuildFingerprintInput {
  owner: string;
  repo: string;
  branch: string;
  /** GitHub repo description. */
  description?: string;
  /** GitHub repo topics. */
  topics: string[];
  /** Config file paths found in tree (from scanTree). */
  configFiles: string[];
  /** Paths of files to fetch for dependency extraction. */
  filesToFetch: string[];
}

/**
 * Build a repo fingerprint from pre-resolved inputs. The caller is
 * responsible for resolving the branch, fetching metadata, and scanning the
 * tree — this function only fetches file contents and assembles the result.
 */
export async function buildRepoFingerprint(
  input: BuildFingerprintInput,
): Promise<RepoFingerprint> {
  const { owner, repo, branch, description, topics, configFiles, filesToFetch } =
    input;

  // Fetch all needed files in one parallel burst
  const fileContents = await Promise.all(
    filesToFetch.map(async (path) => {
      const content = await fetchRawFile(owner, repo, branch, path);
      return { path, content };
    }),
  );

  const packages = new Set<string>();
  const languages = new Set<string>();
  let readmeExcerpt: string | undefined;

  for (const { path, content } of fileContents) {
    if (!content) continue;
    const filename = path.split("/").pop() ?? "";

    // README
    if (filename.toLowerCase() === "readme.md") {
      readmeExcerpt = content.slice(0, README_EXCERPT_LIMIT);
      continue;
    }

    // Root or workspace package.json
    if (filename === "package.json") {
      const pkg = parsePackageJson(content);
      if (pkg) {
        languages.add("javascript");
        const deps = {
          ...(pkg.dependencies ?? {}),
          ...(pkg.devDependencies ?? {}),
        };
        for (const name of Object.keys(deps)) packages.add(name);
      }
      continue;
    }

    // Non-JS dependency files
    const lang = FILE_LANGUAGE_MAP[filename];
    if (lang) {
      languages.add(lang);
      for (const pkg of parseNonJsPackages(filename, content)) {
        packages.add(pkg);
      }
    }
  }

  return {
    packages: Array.from(packages),
    configFiles,
    languages: Array.from(languages),
    description,
    topics,
    readmeExcerpt,
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

export { parseGitHubUrl };
