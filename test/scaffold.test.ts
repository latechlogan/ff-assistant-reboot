import { describe, expect, test } from "vitest";
import type { AsOf } from "../src/core/ports.ts";

/**
 * Placeholder so the suite is non-empty before slice 1's criteria tests land.
 * Delete it with the first real test file.
 */
describe("scaffold", () => {
  test("ports type-check and the runner is wired", () => {
    const payload: AsOf<{ week: number }> = {
      data: { week: 3 },
      fetchedAt: "2026-09-18T00:00:00.000Z",
      source: "fixture",
      file: "test/scaffold.test.ts",
    };
    expect(payload.data.week).toBe(3);
  });
});
