import { describe, expect, test } from "vitest";
import {
  leagueFixture,
  playersFixture,
  rosterById,
  rostersFixture,
} from "../../../test/load-fixtures.ts";
import {
  PRICED_POSITIONS,
  type IndexedPlayer,
  type LeagueConfig,
  type PlayerIndex,
  type Position,
} from "../types.ts";
import { summarizeLeagueState, type RosterPayload } from "./state.ts";

/**
 * AC5 — a roster with `settings.eliminated: 1` is excluded from live rosters and its
 * players are back in the available pool.
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
  test("AC5 — `eliminated: 1` is chopped; the key being absent means alive", () => {
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

  test("AC5 — a chopped roster's players are back in the available pool", () => {
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

describe("the available pool is what is observed, not what the shape allows", () => {
  test("AC6 — reserve and taxi count as owned, not available", () => {
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

  test("AC6 — an over-full roster still yields a correct pool, because the pool is a complement", () => {
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

  test("AC8 — the same rosters produce the same pool twice, whatever order they arrive in", () => {
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
  test("AC7 — the FAAB pool sums remaining budget over live rosters only", () => {
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

  test("AC7 — a league with no FAAB currency has a null pool, never an invented number", () => {
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
