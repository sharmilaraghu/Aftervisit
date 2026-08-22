import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Overriding ignores replaces eslint-config-next's defaults, so restate them.
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Generated migrations and plugin scratch space — not ours to lint.
    "drizzle/**",
    ".remember/**",
    ".impeccable/**",
  ]),
]);

export default eslintConfig;
