import { describe, expect, test } from "vitest";
import { lastMeaningfulWeek } from "./last-meaningful-week.ts";
import { survivalWeights } from "./weights.ts";

/**
 * A guillotine season ends when one team is left (tickets/006). The last week worth
 * pricing is a fact of the schedule — live teams and the room's own chop cadence — not
 * a season length anyone typed in. These tests are written from the approved criteria
 * before the function exists (docs/trust.md, "who writes the tests"), so every number
 * below is arithmetic from the ticket, never from reading an implementation.
 *
 * `throughWeek` is the NFL's last week, passed in by the caller: the horizon may end
 * earlier than the schedule but never later.
 */

describe("the last week a chop still decides anything", () => {
  test("AC1 — the last priced week is the week of the final chop, and never later than the caller's last NFL week", () => {
    /**
     * `week + ceil((liveTeams − 1) / chopsPerWeek) − 1`. Each example is the ticket's,
     * worked by hand:
     *
     *   week 3, 14 live, 1 a week:  13 chops at 1 a week = 13 weeks, 3…15  → 15
     *   week 1, 16 live, 1 a week:  15 chops at 1 a week = 15 weeks, 1…15  → 15
     *   week 3, 14 live, 2 a week:  13 chops at 2 a week = 7 weeks,  3…9   → 9
     *   week 15, 2 live, 1 a week:   1 chop                          15    → 15
     */
    expect(lastMeaningfulWeek({ week: 3, liveTeams: 14, chopsPerWeek: 1, throughWeek: 18 })).toBe(
      15,
    );
    expect(lastMeaningfulWeek({ week: 1, liveTeams: 16, chopsPerWeek: 1, throughWeek: 18 })).toBe(
      15,
    );
    expect(lastMeaningfulWeek({ week: 3, liveTeams: 14, chopsPerWeek: 2, throughWeek: 18 })).toBe(
      9,
    );
    expect(lastMeaningfulWeek({ week: 15, liveTeams: 2, chopsPerWeek: 1, throughWeek: 18 })).toBe(
      15,
    );

    // "Never later than the NFL's last week passed in by the caller": a room that would
    // still be chopping in week 20 is priced only as far as the schedule goes. The
    // horizon is the smaller of the two, and neither number is hardcoded here.
    expect(lastMeaningfulWeek({ week: 3, liveTeams: 14, chopsPerWeek: 1, throughWeek: 12 })).toBe(
      12,
    );
    expect(lastMeaningfulWeek({ week: 10, liveTeams: 16, chopsPerWeek: 1, throughWeek: 18 })).toBe(
      18,
    );
  });

  test("AC2 — the survival curve covers the priced weeks and no more: 13 entries summing to 7.4286", () => {
    // The ticket's own case: week 3, 14 live, one chop a week. The window the curve is
    // asked for is exactly the weeks the function says are worth pricing.
    const week = 3;
    const last = lastMeaningfulWeek({ week, liveTeams: 14, chopsPerWeek: 1, throughWeek: 18 });
    const weeksRemaining = last - week + 1;

    expect(weeksRemaining).toBe(13); // weeks 3…15, the 13 waiver periods that matter

    const weights = survivalWeights({ liveTeams: 14, weeksRemaining, chopsPerWeek: 1 });

    /**
     * Surviving each chop compounds: 14/14, 13/14, 12/14, … 2/14. The last entry is
     * week 15, where two teams are left and one of them is you. There is no 1/14 entry
     * and no flattened tail — weeks 16–18 decide nothing and are never asked for.
     */
    expect(weights).toHaveLength(13);
    for (const [i, weight] of weights.entries()) {
      expect(weight).toBeCloseTo((14 - i) / 14, 10);
    }
    expect(weights[0]).toBe(1);
    expect(weights[12]).toBeCloseTo(2 / 14, 10);

    // (14 + 13 + … + 2) / 14 = 104/14 = 7.428571…
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    expect(total).toBeCloseTo(7.4286, 4);
  });

  test("AC4 — with one team left the season is decided, and no week after it is priced", () => {
    /**
     * The 16-team room chops through week 15 and one team is left. Week 17 is the case
     * the cadence check trips over today (tickets/005's review): Sleeper shows 1 live
     * roster where `teams − chopsPerWeek × (week − 1)` reaches 0.
     *
     * With no chop left to make, the last meaningful week is already behind us: the
     * function returns a week earlier than the current one, which is the machine-
     * readable form of "the season is decided, there is nothing here to price".
     */
    const last = lastMeaningfulWeek({ week: 17, liveTeams: 1, chopsPerWeek: 1, throughWeek: 18 });

    expect(last).toBeLessThan(17);
    expect(last).toBe(16); // week + ceil(0 / 1) − 1
  });
});
