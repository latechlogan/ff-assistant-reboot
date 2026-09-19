import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    // No network in the check command: a test that needs Sleeper is a live smoke
    // test, run by hand (docs/trust.md).
    environment: "node",
  },
});
