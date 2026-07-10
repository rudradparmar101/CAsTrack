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
    // Archived DeadlineTracker reference code (Deno edge function + old SQL) —
    // not part of the app, not held to its lint standards. See its README.
    "supabase/_legacy-deadlinetracker/**",
  ]),
]);

export default eslintConfig;
