import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Node build/utility scripts (CommonJS, run outside the app bundle).
    "scripts/**",
    // Vendored bklit chart components, installed-as-source via the @bklit shadcn
    // registry (`npx shadcn add @bklit/...`). Third-party code we don't author:
    // its ref-during-render / animation patterns don't satisfy this repo's strict
    // React Compiler lint rules, the same way a node_module wouldn't. Treated like
    // generated/vendored code (cf. convex/_generated) rather than linted here.
    "components/charts/**",
  ]),
]);

export default eslintConfig;
