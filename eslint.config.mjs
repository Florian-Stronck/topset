import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // The Electron shell runs as plain CommonJS in Node, outside the Next.js build.
  {
    files: ["electron/**/*.js"],
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // The packaged desktop app, with a copy of the built site inside.
    "dist-desktop/**",
    "release/**",
    "graphify-out/**",
    // Claude Code worktrees, each a full checkout of its own.
    ".claude/**",
  ]),
]);

export default eslintConfig;
