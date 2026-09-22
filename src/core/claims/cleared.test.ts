import { describe, expect, test } from "vitest";
import { claimsHaveCleared, type ClaimRecord } from "./cleared.ts";

/**
 * AC6's rule, from observed data only (tickets/004).
 *
 * Written by the implementer: this is a predicate over a payload, not pricing math,
 * so it is not one of the four modules docs/trust.md hands to a separate agent.
 */

const waiver = (status: string): ClaimRecord => ({ type: "waiver", status });

describe("whether a week's waivers have already run", () => {
  test("004 AC6 — a completed waiver claim means the week's claims have cleared", () => {
    expect(claimsHaveCleared([waiver("complete")])).toBe(true);
  });

  test("004 AC6 — a failed waiver claim means they cleared too: someone was outbid", () => {
    expect(claimsHaveCleared([waiver("failed")])).toBe(true);
  });

  test("004 AC6 — a claim still sitting in the queue has not cleared", () => {
    expect(claimsHaveCleared([waiver("pending"), waiver("processing")])).toBe(false);
  });

  test("004 AC6 — a free-agent pickup is not a waiver run, however it ended", () => {
    expect(
      claimsHaveCleared([
        { type: "free_agent", status: "complete" },
        { type: "trade", status: "complete" },
      ]),
    ).toBe(false);
  });

  test("004 AC6 — one settled claim among many pending ones is enough", () => {
    expect(claimsHaveCleared([waiver("pending"), waiver("complete"), waiver("pending")])).toBe(
      true,
    );
  });

  test("004 AC6 — a week nobody claimed in never locks, and that is the accepted gap", () => {
    // Known and accepted (tickets/004, AC6): with no waiver transaction there is
    // nothing to observe, so the board stays overwritable all week. Tolerable,
    // because a week with no claims is a week whose board said "nothing to claim".
    expect(claimsHaveCleared([])).toBe(false);
  });
});
