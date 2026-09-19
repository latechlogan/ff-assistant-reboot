/**
 * The architectural boundary from docs/architecture.md, as a check.
 *
 * src/core is pure: no I/O, no adapters. Adapters may depend on the core;
 * the core may not depend on them. See eslint.config.js for the other half —
 * globals (fetch, Date, process) that need no import.
 */
module.exports = {
  forbidden: [
    {
      name: "core-imports-no-adapter",
      comment:
        "src/core must not import an adapter. The core defines ports; adapters implement them.",
      severity: "error",
      from: { path: "^src/core" },
      to: { path: "^src/adapters" },
    },
    {
      name: "core-imports-no-io",
      comment:
        "src/core must not touch the filesystem, network, processes, or the OS. That is an adapter's job, and it is what makes a rerun identical.",
      severity: "error",
      from: { path: "^src/core" },
      to: {
        path: "^(node:)?(fs|http|https|net|dns|child_process|os|process|worker_threads|cluster)(/|$)",
      },
    },
    {
      name: "no-circular",
      comment: "A cycle means the boundary is wrong.",
      severity: "error",
      from: {},
      to: { circular: true },
    },
    {
      name: "no-orphans",
      comment: "An unreferenced module is either dead or not wired up yet.",
      severity: "warn",
      from: { orphan: true, pathNot: ["\\.d\\.ts$", "(^|/)ports\\.ts$"] },
      to: {},
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    tsConfig: { fileName: "tsconfig.json" },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: { extensions: [".ts", ".js"] },
  },
};
