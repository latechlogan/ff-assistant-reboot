import js from "@eslint/js";
import tseslint from "typescript-eslint";

/**
 * Two jobs: ordinary type-aware linting everywhere, and the half of the
 * core-purity rule that dependency-cruiser cannot see.
 *
 * depcruise catches forbidden *imports* (node:fs, an adapter). It cannot catch
 * `fetch(...)` or `Date.now()`, which are globals and need no import — so those
 * are banned here, for src/core only. Between the two, a core module cannot
 * reach the network, the filesystem, the clock, or the environment.
 */
export default tseslint.config(
  {
    ignores: [
      "node_modules",
      "docs/graph.md",
      "coverage",
      "reports",
      ".stryker-tmp",
      // Subagent worktrees: full checkouts of this repo, linted in their own tree.
      ".claude/worktrees",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        // Config files sit outside tsconfig's include; lint them without a program.
        projectService: { allowDefaultProject: ["*.js", "*.cjs", "*.config.ts"] },
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    rules: {
      // A leading underscore marks a parameter that is deliberately unused —
      // every stub signature, and every callback that ignores an argument.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
    },
  },
  {
    files: ["src/core/**/*.ts"],
    ignores: ["src/core/**/*.test.ts"],
    rules: {
      "no-restricted-globals": [
        "error",
        { name: "fetch", message: "src/core is pure — fetching belongs in an adapter." },
        { name: "Date", message: "src/core reads no clock — pass the time in as data." },
        { name: "process", message: "src/core reads no environment — pass config in as data." },
      ],
      "no-restricted-properties": [
        "error",
        {
          object: "Math",
          property: "random",
          message: "src/core is deterministic — no randomness near a price.",
        },
      ],
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: ["node:*"], message: "src/core is pure — node builtins belong in adapters." },
            { group: ["**/adapters/**"], message: "The core never imports an adapter." },
          ],
        },
      ],
    },
  },
  {
    // dependency-cruiser's config is CommonJS by necessity — it is the one file here that is.
    files: ["**/*.cjs"],
    languageOptions: { globals: { module: "writable", require: "readonly" } },
  },
  {
    files: ["**/*.test.ts", "scripts/**/*.ts"],
    rules: { "@typescript-eslint/no-unsafe-assignment": "off" },
  },
);
