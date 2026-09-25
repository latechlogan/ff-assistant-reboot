import { describe, expect, test } from "vitest";
import legs from "../../../test/fixtures/transactions-leg3.json" with { type: "json" };
import { claimsHaveCleared } from "./cleared.ts";

/**
 * When a week-N board's claims have run (tickets/014, replacing tickets/004's rule).
 *
 * Written by the implementer: this is a predicate over a payload, not pricing math,
 * so it is not one of the four modules docs/trust.md hands to a separate agent.
 */

describe("whether a week-N board's waivers have already run", () => {
  test("014 AC1 — leg 3 before the run is empty: the week-3 board is still open", () => {
    expect(legs.choppedLeg3BeforeRun).toHaveLength(0);
    expect(claimsHaveCleared(legs.choppedLeg3BeforeRun)).toBe(false);
  });

  test("014 AC1 — chopped leg 3 after the run holds only free-agent pickups, and that is enough", () => {
    expect(legs.choppedLeg3AfterRun).toHaveLength(10);
    expect(legs.choppedLeg3AfterRun.every((t) => t.type === "free_agent")).toBe(true);
    expect(claimsHaveCleared(legs.choppedLeg3AfterRun)).toBe(true);
  });

  test("014 AC1 — standard leg 3 after the run: a rolling-waiver week with no claims still locks", () => {
    expect(legs.standardLeg3AfterRun).toHaveLength(6);
    expect(claimsHaveCleared(legs.standardLeg3AfterRun)).toBe(true);
  });

  test("014 AC2 — a claim still pending in leg N was placed after leg N−1's run, so the run happened", () => {
    expect(claimsHaveCleared([{ type: "waiver", status: "pending" }])).toBe(true);
  });
});
