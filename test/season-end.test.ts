import { createHash } from "node:crypto";
import { describe, expect, test } from "vitest";
import { buildWaiverBoard } from "../src/core/board/build.ts";
import { deriveLeagueConfig } from "../src/core/config/derive.ts";
import { buildPlayerIndex } from "../src/core/players/index-players.ts";
import {
  assertChopCadence,
  summarizeLeagueState,
  type RosterPayload,
} from "../src/core/rosters/state.ts";
import { scoreStatLine } from "../src/core/scoring/score.ts";
import type { LeagueConfig, PlayerIndex, WeeklyPoints } from "../src/core/types.ts";
import {
  leagueFixture,
  playersFixture,
  projectionsFixture,
  rostersFixture,
} from "./load-fixtures.ts";

/**
 * Ticket 006 at the board/CLI seam: a guillotine season ends when one team is left, so
 * nothing after that week is priced and the last chop releases a roster nobody can use.
 *
 * Written from the approved criteria before the implementation exists (docs/trust.md).
 * Every expectation is the ticket's arithmetic over the committed fixtures — no number
 * here was read off a board.
 */

/** NFL fact, and what `src/adapters/cli/waivers.ts` passes as the caller's horizon. */
const LAST_NFL_WEEK = 18;

/**
 * The fixture room, at a chosen week and live-team count.
 *
 * The fixtures are trimmed to three rosters, so the ticket's worked examples (14 live
 * in week 3, 3 live in week 14, 2 live in week 15) are built by cloning the fixture's
 * own live and chopped rosters up to the league's own `total_rosters`. The cadence is
 * kept honest — a chopped roster carries the week it was chopped, 1…n — so
 * `assertChopCadence` agrees with every room these tests price.
 */
function roomOf(liveTeams: number): RosterPayload[] {
  const fixture = rostersFixture();
  const liveTemplates = fixture.filter((roster) => roster.settings.eliminated == null);
  const choppedTemplate = fixture.find((roster) => roster.settings.eliminated != null);
  if (liveTemplates.length === 0 || !choppedTemplate) {
    throw new Error("the guillotine fixture no longer holds both a live and a chopped roster");
  }
  const teams = leagueFixture().total_rosters;

  const live: RosterPayload[] = Array.from({ length: liveTeams }, (_, i) => {
    const template = liveTemplates[i % liveTemplates.length] as RosterPayload;
    return { ...template, roster_id: i + 1, settings: { ...template.settings } };
  });
  const chopped: RosterPayload[] = Array.from({ length: teams - liveTeams }, (_, i) => ({
    ...choppedTemplate,
    roster_id: liveTeams + i + 1,
    // Chopped in week i + 1: the value Sleeper stores is the week it happened (ticket 005).
    settings: { ...choppedTemplate.settings, eliminated: i + 1 },
  }));

  return [...live, ...chopped];
}

/**
 * The fixture's one week of projections, repeated for every week of the season.
 *
 * The committed projections hold week 2 only. Repeating the same scored stat line for
 * each week gives every horizon real points to sum, so a week dropped from the horizon
 * actually changes the arithmetic instead of being invisible.
 */
function weeklyEveryWeek(index: PlayerIndex, config: LeagueConfig): WeeklyPoints[] {
  const rows = projectionsFixture().filter((row) => index.has(row.player_id));
  const weekly: WeeklyPoints[] = [];
  for (let week = 1; week <= LAST_NFL_WEEK; week++) {
    for (const row of rows) {
      weekly.push({
        playerId: row.player_id,
        week,
        points: scoreStatLine(row.stats, config.scoring),
      });
    }
  }
  return weekly;
}

/** A guillotine board for the fixture room at `week` with `liveTeams` alive. */
function guillotineBoard(week: number, liveTeams: number) {
  const config = deriveLeagueConfig(leagueFixture());
  const index = buildPlayerIndex(playersFixture());
  const state = summarizeLeagueState({ rosters: roomOf(liveTeams), index, config, week });

  return buildWaiverBoard({
    config,
    index,
    state,
    weekly: weeklyEveryWeek(index, config),
    // The CLI passes the NFL's last week; the board is what decides to stop earlier.
    throughWeek: LAST_NFL_WEEK,
    chopsPerWeek: 1,
  });
}

describe("a guillotine season stops at the week it is decided", () => {
  test("AC2 — rest-of-season points include no week after the last priced week", () => {
    // Week 3, 14 live, one chop a week: the 13 waiver periods that matter are 3…15.
    const { diagnostics } = guillotineBoard(3, 14);

    expect(diagnostics.week).toBe(3);
    expect(diagnostics.throughWeek).toBe(15); // not 18: weeks 16–18 decide nothing

    const weights = diagnostics.survivalWeights;
    expect(weights).not.toBeNull();
    expect(weights).toHaveLength(13); // one weight per priced week, and no flattened tail

    // 14/14, 13/14, … 2/14 — the curve the room's own cadence produces.
    for (const [i, weight] of (weights ?? []).entries()) {
      expect(weight).toBeCloseTo((14 - i) / 14, 10);
    }
    const total = (weights ?? []).reduce((sum, weight) => sum + weight, 0);
    expect(total).toBeCloseTo(7.4286, 4); // 104/14, the ticket's number, ±1e-4
  });

  test("AC3 — supply counts only the releases that can still be claimed and played", () => {
    // A chop counts only if at least one priced week remains after it. Week 3, 14 live:
    // chops follow weeks 3…15, and the one after week 15 releases a roster nobody can
    // use — 12 releases worth buying, not 13.
    const week3 = guillotineBoard(3, 14);
    const economy = week3.diagnostics.economy;
    if (!economy) throw new Error("the fixture league has FAAB; this should not be null");

    expect(economy.chopsRemaining).toBe(12);
    expect(economy.chopsRemaining).not.toBe(week3.diagnostics.liveTeams - 1);
    // And the supply is spread over those 12 releases, not 13 — this is the ~8% the
    // ticket says $/VORP is understated by.
    expect(economy.supply).toBeCloseTo(economy.availableVorp + 12 * economy.rosteredVorpPerTeam, 6);

    // Week 15, 2 live: the last chop follows week 15, so nothing released is playable.
    expect(guillotineBoard(15, 2).diagnostics.economy?.chopsRemaining).toBe(0);

    // Week 14, 3 live: the chop after week 14 releases a roster week 15 can still use.
    expect(guillotineBoard(14, 3).diagnostics.economy?.chopsRemaining).toBe(1);
  });

  test("AC4 — one team left is a decided season, not a cadence error", () => {
    const config = deriveLeagueConfig(leagueFixture());
    const index = buildPlayerIndex(playersFixture());
    // Week 17 of the 16-team room: the week-15 chop left one team, and `teams −
    // chopsPerWeek × (week − 1)` reaches 0 while Sleeper still shows 1 (ticket 005's
    // review). A decided season is a state to report, not a room we are reading wrong.
    const state = summarizeLeagueState({ rosters: roomOf(1), index, config, week: 17 });

    expect(state.liveTeams).toBe(1);
    expect(() => assertChopCadence({ config, state, chopsPerWeek: 1 })).not.toThrow();
  });

  test("AC5 — the footer's two numbers come from the board: the week it is decided, and the releases left", () => {
    // The CLI does no arithmetic of its own (CLAUDE.md), so both numbers the footer
    // states have to be on the board's diagnostics before it can print them.
    const { diagnostics } = guillotineBoard(3, 14);

    expect(diagnostics.throughWeek).toBe(15); // "season decided in week 15"
    expect(diagnostics.economy?.chopsRemaining).toBe(12); // releases still worth buying
    // The old footer said "13 chops still to come" — a count that includes the last one.
    expect(diagnostics.economy?.chopsRemaining).not.toBe(13);
  });
});

describe("the standard league is untouched", () => {
  /**
   * The same fixtures read as a redraft room (Sleeper's league type 0), which is what
   * makes it standard rather than guillotine. Nothing in this ticket may move it.
   */
  function standardBoard() {
    const payload = leagueFixture();
    payload.settings.type = 0;

    const config = deriveLeagueConfig(payload);
    const index = buildPlayerIndex(playersFixture());
    const state = summarizeLeagueState({ rosters: rostersFixture(), index, config, week: 2 });
    const weekly: WeeklyPoints[] = projectionsFixture()
      .filter((row) => index.has(row.player_id))
      .map((row) => ({
        playerId: row.player_id,
        week: row.week,
        points: scoreStatLine(row.stats, config.scoring),
      }));

    return buildWaiverBoard({ config, index, state, weekly, throughWeek: LAST_NFL_WEEK });
  }

  test("AC6 — the standard league's board is byte-identical before and after this change", () => {
    const board = standardBoard();

    // The horizon is the caller's, untouched: a standard room has no chop cadence to
    // derive one from, and its horizon is a separate question (tickets/006, Boundary).
    expect(board.diagnostics.throughWeek).toBe(LAST_NFL_WEEK);
    expect(board.diagnostics.survivalWeights).toBeNull();
    expect(board.diagnostics.economy?.chopsRemaining).toBe(0);

    /**
     * And every printed number, byte for byte. The digest is of the board as it stands
     * on `main` before this ticket — if the implementation moves a single dollar on the
     * standard side, this fails, and no eyeballing of a diff could have caught it.
     *
     * Regenerate ONLY with Logan's say-so: a changed digest here is the ticket
     * overreaching, not a stale expectation.
     */
    const serialized = JSON.stringify({ everyRow: board.everyRow, diagnostics: board.diagnostics });
    expect(createHash("sha256").update(serialized).digest("hex")).toBe(
      "3583ec89ab03fd5eb168187cc3ea1555d013f9cad735f5675fee947e37a55d50",
    );
  });
});
