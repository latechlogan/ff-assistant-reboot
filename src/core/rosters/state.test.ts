import { describe, expect, test } from "vitest";
import {
  leagueFixture,
  playersFixture,
  rosterById,
  rostersFixture,
} from "../../../test/load-fixtures.ts";
import {
  ChopCadenceError,
  PRICED_POSITIONS,
  type IndexedPlayer,
  type LeagueConfig,
  type PlayerIndex,
  type Position,
} from "../types.ts";
import { assertChopCadence, summarizeLeagueState, type RosterPayload } from "./state.ts";

/**
 * AC5 — a roster with `settings.eliminated` set (it holds the chop week; ticket 005) is
 * excluded from live rosters and its players are back in the available pool.
 * AC6 — the pool is the complement of the union of live rosters' players, reserve and
 * taxi, even when a roster holds more players than the shape allows.
 * AC7 — the FAAB pool this value is spread over is Σ remaining across LIVE rosters.
 * AC8 — the same inputs produce the same state, in the same order.
 *
 * The index and the config are built here rather than through `buildPlayerIndex` and
 * `deriveLeagueConfig`, so that a failure in this file is a failure in this module.
 */

const PRICED = new Set<string>(PRICED_POSITIONS);

/** The fixture player map as an index: 86 players, each at a priced slot. */
function fixtureIndex(): PlayerIndex {
  const index = new Map<string, IndexedPlayer>();
  for (const [playerId, player] of Object.entries(playersFixture())) {
    const own = player.position ?? "";
    const slot = PRICED.has(own)
      ? own
      : (player.fantasy_positions ?? []).find((eligible) => PRICED.has(eligible));
    if (!slot) continue;
    index.set(playerId, {
      playerId,
      name: player.full_name ?? "",
      position: slot as Position,
      team: player.team ?? null,
    });
  }
  return index;
}

/** The fixture league's config, taken from its own payload — never a constant. */
function fixtureConfig(overrides: Partial<LeagueConfig> = {}): LeagueConfig {
  const payload = leagueFixture();
  return {
    leagueId: payload.league_id,
    season: payload.season,
    teams: payload.total_rosters,
    draftBudget: null,
    rosterPositions: payload.roster_positions,
    starters: { QB: 1, RB: 2, WR: 2, TE: 1, K: 1 },
    flexSlots: 2,
    benchSlots: 6,
    rosterSize: 15,
    scoring: payload.scoring_settings,
    format: "guillotine",
    waiver: {
      kind: "faab",
      budget: payload.settings.waiver_budget ?? null,
      minBid: payload.settings.waiver_bid_min ?? null,
    },
    ...overrides,
  };
}

const BUDGET = leagueFixture().settings.waiver_budget ?? 0; // 1000, from the payload

describe("who is live and who is chopped", () => {
  test("001 AC5 — `eliminated: 1` is chopped; the key being absent means alive", () => {
    const index = fixtureIndex();

    const state = summarizeLeagueState({
      rosters: rostersFixture(),
      index,
      config: fixtureConfig(),
      week: 2,
    });

    expect(state.week).toBe(2);
    expect(state.liveTeams).toBe(2); // rosters 1 and 2 carry no `eliminated` key at all
    expect(state.choppedTeams).toBe(1); // roster 12 carries `eliminated: 1`
    expect(state.rosters.find((r) => r.rosterId === 12)?.eliminated).toBe(true);
    expect(state.rosters.find((r) => r.rosterId === 1)?.eliminated).toBe(false);
    // 86 indexed players − the 30 held by the two live rosters.
    expect(state.rosteredIds.size).toBe(30);
    expect(state.availableIds).toHaveLength(56);
  });

  test("001 AC5 — a chopped roster's players are back in the available pool", () => {
    const rosters = rostersFixture();
    const chopped = rosterById(rosters, 2); // 15 real players, then chopped
    chopped.settings.eliminated = 1;
    const held = chopped.players ?? [];

    const state = summarizeLeagueState({
      rosters,
      index: fixtureIndex(),
      config: fixtureConfig(),
      week: 3,
    });

    expect(held).toHaveLength(15);
    expect(state.liveTeams).toBe(1);
    expect(state.choppedTeams).toBe(2);
    for (const playerId of held) {
      expect(state.rosteredIds.has(playerId)).toBe(false);
      expect(state.availableIds).toContain(playerId);
    }
    // Only roster 1's 15 players are still owned: 86 − 15 = 71 available.
    expect(state.availableIds).toHaveLength(71);
  });
});

/**
 * Ticket 005. `eliminated` is the WEEK a roster was chopped, not a flag: the live week-3
 * pull (2026-09-22) carried `2` and `1`. Reading it as `=== 1` priced the week-2 victim
 * as a live team — and nothing complained, because its players were already released.
 */
describe("a chop is recorded as the week it happened", () => {
  test("005 AC1 — any integer in `eliminated` means chopped; absent or null means alive", () => {
    const rosters = rostersFixture();
    rosterById(rosters, 2).settings.eliminated = 2;
    rosterById(rosters, 1).settings.eliminated = null;

    const state = summarizeLeagueState({
      rosters,
      index: fixtureIndex(),
      config: fixtureConfig(),
      week: 3,
    });

    expect(state.rosters.find((r) => r.rosterId === 2)?.eliminated).toBe(true);
    expect(state.rosters.find((r) => r.rosterId === 12)?.eliminated).toBe(true);
    expect(state.rosters.find((r) => r.rosterId === 1)?.eliminated).toBe(false);
  });

  test("005 AC2 — rosters chopped in weeks 1 and 2 are both out, players and money alike", () => {
    const rosters = rostersFixture();
    const chopped = rosterById(rosters, 2); // spent 24 before being chopped
    chopped.settings.eliminated = 2;
    const held = chopped.players ?? [];

    const state = summarizeLeagueState({
      rosters,
      index: fixtureIndex(),
      config: fixtureConfig(),
      week: 3,
    });

    expect(state.liveTeams).toBe(1);
    expect(state.choppedTeams).toBe(2);
    for (const playerId of held) expect(state.availableIds).toContain(playerId);
    // Only roster 1 is live: its 999 remaining, not roster 2's 976 on top.
    expect(state.faabPool).toBe(BUDGET - 1);
  });
});

describe("the live count must match the chop cadence", () => {
  // The fixture is 3 of 16 rosters, so the count the check reads is set by hand: the
  // question is only whether the check compares it to the cadence correctly.
  const base = summarizeLeagueState({
    rosters: rostersFixture(),
    index: fixtureIndex(),
    config: fixtureConfig(),
    week: 3,
  });
  const teams = fixtureConfig().teams; // 16, from the payload

  test("005 AC3 — a live count that matches the cadence passes", () => {
    // Week 3 at one chop a week: chops after weeks 1 and 2, so 16 − 2 = 14.
    expect(() =>
      assertChopCadence({
        config: fixtureConfig(),
        state: { ...base, week: 3, liveTeams: teams - 2 },
        chopsPerWeek: 1,
      }),
    ).not.toThrow();
    // Two a week doubles the chops: 16 − 4 = 12.
    expect(() =>
      assertChopCadence({
        config: fixtureConfig(),
        state: { ...base, week: 3, liveTeams: teams - 4 },
        chopsPerWeek: 2,
      }),
    ).not.toThrow();
  });

  test("005 AC3 — a live count off the cadence stops the run, naming both numbers and the week", () => {
    // The 2026-09-22 failure exactly: 15 read as live where the cadence says 14.
    const run = () =>
      assertChopCadence({
        config: fixtureConfig(),
        state: { ...base, week: 3, liveTeams: teams - 1 },
        chopsPerWeek: 1,
      });

    expect(run).toThrow(ChopCadenceError);
    expect(run).toThrow(/15/);
    expect(run).toThrow(/14/);
    expect(run).toThrow(/week 3/);
  });

  /**
   * Ticket 006 floors the expected count at 1, so a decided season reaches the board
   * instead of being refused as a miscount. Past the decided week the floor demands
   * EXACTLY one survivor — replace it with an early return and this is the test that
   * notices, because everything else about a decided room still passes.
   */
  test("006 AC4 — past the decided week the floor still demands exactly one survivor", () => {
    // 16 teams at one a week are decided in week 15; week 17 may only ever show 1.
    expect(() =>
      assertChopCadence({
        config: fixtureConfig(),
        state: { ...base, week: 17, liveTeams: 1 },
        chopsPerWeek: 1,
      }),
    ).not.toThrow();

    for (const liveTeams of [2, 14]) {
      expect(() =>
        assertChopCadence({
          config: fixtureConfig(),
          state: { ...base, week: 17, liveTeams },
          chopsPerWeek: 1,
        }),
      ).toThrow(ChopCadenceError);
    }
  });

  test("005 AC3 — a league that is not a guillotine has no cadence to check", () => {
    expect(() =>
      assertChopCadence({
        config: fixtureConfig({ format: "standard" }),
        state: { ...base, liveTeams: teams },
        chopsPerWeek: 1,
      }),
    ).not.toThrow();
  });
});

describe("the available pool is what is observed, not what the shape allows", () => {
  test("001 AC6 — reserve and taxi count as owned, not available", () => {
    const index = fixtureIndex();
    const [first = "", second = "", third = ""] = [...index.keys()];
    const rosters: RosterPayload[] = [
      {
        roster_id: 1,
        owner_id: "owner_001",
        players: [first],
        reserve: [second],
        taxi: [third],
        settings: { waiver_budget_used: 0 },
      },
    ];

    const state = summarizeLeagueState({ rosters, index, config: fixtureConfig(), week: 2 });

    expect(state.rosteredIds.size).toBe(3);
    expect(state.availableIds).toHaveLength(index.size - 3); // 86 − 3 = 83
    for (const playerId of [first, second, third]) {
      expect(state.availableIds).not.toContain(playerId);
    }
  });

  test("001 AC6 — an over-full roster still yields a correct pool, because the pool is a complement", () => {
    const index = fixtureIndex();
    const rosters = rostersFixture();
    const owned = rosterById(rosters, 1).players ?? [];
    const spare = [...index.keys()].filter((id) => !owned.includes(id)).slice(0, 2);
    const overFull: RosterPayload[] = [
      {
        roster_id: 1,
        owner_id: "owner_001",
        players: [...owned, ...spare], // 17 players against a 15-slot shape
        reserve: null,
        taxi: null,
        settings: { waiver_budget_used: 0 },
      },
    ];

    const state = summarizeLeagueState({
      rosters: overFull,
      index,
      config: fixtureConfig(),
      week: 2,
    });

    // Observed: 86 − 17 = 69. Anything derived from the shape is wrong here — the
    // roster holds 17 against rosterSize 15, and teams × rosterSize (16 × 15 = 240)
    // is not even a possible pool for an 86-player universe.
    expect(state.rosteredIds.size).toBe(17);
    expect(state.availableIds).toHaveLength(69);
    expect(state.availableIds).not.toHaveLength(index.size - 15);
  });

  test("001 AC8 — the same rosters produce the same pool twice, whatever order they arrive in", () => {
    const config = fixtureConfig();
    const args = { index: fixtureIndex(), config, week: 2 };

    const first = summarizeLeagueState({ ...args, rosters: rostersFixture() });
    const again = summarizeLeagueState({ ...args, rosters: rostersFixture() });
    const reversed = summarizeLeagueState({ ...args, rosters: rostersFixture().reverse() });

    expect(again.availableIds).toEqual(first.availableIds);
    expect(reversed.availableIds).toEqual(first.availableIds);
    expect(reversed.liveTeams).toBe(first.liveTeams);
  });
});

describe("the money the board is priced in", () => {
  test("001 AC7 — the FAAB pool sums remaining budget over live rosters only", () => {
    const state = summarizeLeagueState({
      rosters: rostersFixture(),
      index: fixtureIndex(),
      config: fixtureConfig(),
      week: 2,
    });

    // Roster 1 spent 1, roster 2 spent 24, both live: (1000 − 1) + (1000 − 24) = 1975.
    // Roster 12 is chopped with 1000 unspent; that money left the economy with it.
    expect(state.rosters.find((r) => r.rosterId === 1)?.faabRemaining).toBe(BUDGET - 1);
    expect(state.rosters.find((r) => r.rosterId === 2)?.faabRemaining).toBe(BUDGET - 24);
    expect(state.faabPool).toBe(2 * BUDGET - 25);
  });

  test("001 AC7 — a league with no FAAB currency has a null pool, never an invented number", () => {
    const config = fixtureConfig({ waiver: { kind: "rolling", budget: null, minBid: null } });

    const state = summarizeLeagueState({
      rosters: rostersFixture(),
      index: fixtureIndex(),
      config,
      week: 2,
    });

    expect(state.faabPool).toBeNull();
    for (const roster of state.rosters) {
      expect(roster.faabRemaining).toBeNull();
    }
  });
});
