import { describe, expect, test } from "vitest";
import { buildWaiverBoard } from "../src/core/board/build.ts";
import { deriveLeagueConfig } from "../src/core/config/derive.ts";
import { buildPlayerIndex, type PlayerPayload } from "../src/core/players/index-players.ts";
import { summarizeLeagueState } from "../src/core/rosters/state.ts";
import { scoreStatLine } from "../src/core/scoring/score.ts";
import { PRICED_POSITIONS, type WeeklyPoints } from "../src/core/types.ts";
import {
  leagueFixture,
  playersFixture,
  projectionsFixture,
  rostersFixture,
  type ProjectionFixtureRow,
} from "./load-fixtures.ts";

/**
 * AC1 at the seam below the terminal: the whole pipeline over real fixtures, from
 * payloads to priced rows. The CLI above this only fetches, renders and exits.
 *
 * Written by the implementer, not the criteria author — the core's own tests are the
 * independent ones (docs/trust.md). What this adds is that the pieces compose.
 */

const THROUGH_WEEK = 18;

/** Extra payload rows a test wants layered onto the fixtures before the board is built. */
type Extra = {
  players?: Record<string, PlayerPayload>;
  rows?: ProjectionFixtureRow[];
};

function board(week = 2, extra: Extra = {}) {
  const config = deriveLeagueConfig(leagueFixture());
  const { index } = buildPlayerIndex({ ...playersFixture(), ...extra.players });
  const state = summarizeLeagueState({ rosters: rostersFixture(), index, config, week });

  // The fixture holds one week of projections; every later week is simply absent,
  // which the pipeline must treat as zero rather than as a gap to fill.
  const weekly: WeeklyPoints[] = [...projectionsFixture(), ...(extra.rows ?? [])]
    .filter((row) => index.has(row.player_id))
    .map((row) => ({
      playerId: row.player_id,
      week: row.week,
      points: scoreStatLine(row.stats, config.scoring),
    }));

  return {
    config,
    index,
    state,
    // The cadence comes from the league registry, not from Sleeper, so the caller
    // supplies it — one chop a week is this room's house rule.
    result: buildWaiverBoard({
      config,
      index,
      state,
      weekly,
      throughWeek: THROUGH_WEEK,
      chopsPerWeek: 1,
    }),
  };
}

/**
 * One `active: false` player per priced position, each with a projection big enough to
 * top his position if he ever reached the index. The fixtures are machine-generated
 * from real payloads (`pnpm fixtures`) and hold only active players, so the inactive
 * case is layered on here rather than hand-edited into a file the generator rewrites.
 */
function inactiveRingers(): Extra {
  const players: Record<string, PlayerPayload> = {};
  const rows: ProjectionFixtureRow[] = [];

  for (const position of PRICED_POSITIONS) {
    const id = `retired_${position}`;
    players[id] = {
      player_id: id,
      full_name: `Retired ${position}`,
      position,
      fantasy_positions: [position],
      team: null,
      active: false,
    };
    rows.push({
      player_id: id,
      week: 2,
      season: "2026",
      // A bag deliberately wide enough to score enormously under any of this league's
      // settings, so no position's ringer can fail to displace a real starter.
      stats: { pass_yd: 5000, pass_td: 60, rush_yd: 2000, rec: 200, rec_yd: 3000, fgm: 60 },
    });
  }

  return { players, rows };
}

describe("the board the CLI prints", () => {
  test("AC2 — a guillotine board refuses to guess the chop cadence", () => {
    const config = deriveLeagueConfig(leagueFixture());
    const { index } = buildPlayerIndex(playersFixture());
    const state = summarizeLeagueState({ rosters: rostersFixture(), index, config, week: 2 });

    // Sleeper publishes the format but not the cadence. Assuming one chop a week
    // would price a two-a-week room on a half-speed survival curve.
    expect(() =>
      buildWaiverBoard({ config, index, state, weekly: [], throughWeek: THROUGH_WEEK }),
    ).toThrow(/chopsPerWeek/);
  });

  test("AC1 — every row is an available player above replacement, priced in FAAB dollars", () => {
    const { state, result } = board();

    expect(result.rows.length).toBeGreaterThan(0);
    for (const row of result.rows) {
      expect(state.rosteredIds.has(row.playerId)).toBe(false); // available, by construction
      expect(row.vorp).toBeGreaterThan(0); // above replacement, or it would not print
      expect(row.value).not.toBeNull(); // this league has FAAB, so it has dollars
      expect(row.value ?? 0).toBeGreaterThanOrEqual(0);
    }
    // Sorted by VORP, best first, so the top of the board is the week's decision.
    const vorps = result.rows.map((row) => row.vorp);
    expect([...vorps].sort((a, b) => b - a)).toEqual(vorps);
  });

  test("AC7 — the printed dollars close over the rows that were priced, not over everyone", () => {
    const { state, result } = board();
    const economy = result.diagnostics.economy;
    if (!economy) throw new Error("the fixture league has FAAB; this should not be null");

    // Every available player was priced, including those left off the board.
    expect(economy.pool).toBe(state.faabPool);
    expect(economy.supply).toBeGreaterThanOrEqual(economy.availableVorp);
    // The rows shown are a subset, so their dollars are a fraction of the pool —
    // summing every row in the league would exceed it, which is the 2026 trap.
    const shown = result.rows.reduce((sum, row) => sum + (row.value ?? 0), 0);
    expect(shown).toBeLessThanOrEqual(economy.pool);
  });

  test("AC8 — two runs over the same payloads produce identical boards", () => {
    expect(board().result).toEqual(board().result);
  });

  test("AC5 — a chopped roster's players are priced as available", () => {
    const { index, result } = board();
    const chopped = rostersFixture().find((r) => r.settings.eliminated != null);

    expect(chopped).toBeDefined();
    // The fixture's chopped roster was emptied by Sleeper itself, so the assertion
    // that matters is the inverse: nobody on a LIVE roster is on the board.
    const live = rostersFixture().filter((r) => r.settings.eliminated == null);
    const owned = new Set(live.flatMap((r) => r.players ?? []));
    for (const row of result.rows) {
      expect(owned.has(row.playerId)).toBe(false);
      expect(index.has(row.playerId)).toBe(true);
    }
  });

  test("AC10 — the board says how many rows it left below replacement", () => {
    const { state, result } = board();

    expect(result.diagnostics.belowReplacement).toBe(
      state.availableIds.length - result.rows.length,
    );
    expect(result.diagnostics.availablePool).toBe(state.availableIds.length);
  });

  test("AC4 — replacement levels do not move when inactive players are in the payload", () => {
    // Every player in the fixture is `active: true`, so this board is byte-identical
    // to the one built before ticket 009 existed. It is the "before".
    const before = board().result.diagnostics.replacement;

    // Now put a retired ringer at every priced position into the same payload, each
    // projected to outscore the fixture's best. If the filter failed, they would be
    // indexed, their points would rank above every starter, and every replacement
    // level here would rise. That is what makes this assertion bite.
    const after = board(2, inactiveRingers()).result.diagnostics.replacement;

    expect(after).toEqual(before);
    for (const position of PRICED_POSITIONS) {
      expect(after[position]).toBe(before[position]); // to the last decimal
    }
  });

  test("REG 2026-09-18 — a guillotine board weights the weeks it is likely to be alive for", () => {
    const { result } = board();

    const weights = result.diagnostics.survivalWeights;
    expect(weights).not.toBeNull();
    expect(weights?.[0]).toBe(1); // this week is certain
    expect(weights?.[1] ?? 1).toBeLessThan(1); // every later week is discounted
  });
});

describe("positions with no real market", () => {
  test("REG 2026-09-18 — a floor position is priced at the floor and takes none of the pool", () => {
    const config = deriveLeagueConfig(leagueFixture());
    const { index } = buildPlayerIndex(playersFixture());
    const state = summarizeLeagueState({ rosters: rostersFixture(), index, config, week: 2 });
    const weekly: WeeklyPoints[] = projectionsFixture()
      .filter((row) => index.has(row.player_id))
      .map((row) => ({
        playerId: row.player_id,
        week: row.week,
        points: scoreStatLine(row.stats, config.scoring),
      }));
    const args = { config, index, state, weekly, throughWeek: THROUGH_WEEK, chopsPerWeek: 1 };

    const priced = buildWaiverBoard(args);
    const floored = buildWaiverBoard({ ...args, floorPositions: ["K"] });

    const kickers = floored.rows.filter((row) => row.position === "K");
    expect(kickers.length).toBeGreaterThan(0); // still listed: their points are real
    for (const kicker of kickers) {
      expect(kicker.value).toBe(config.waiver.minBid ?? 0); // the floor, and nothing more
      expect(kicker.vorp).toBeGreaterThan(0); // the VORP shown is still the true one
    }
    // Their dollars did not vanish: with kickers out of the supply, a dollar buys
    // less VORP, so everyone who is actually biddable is worth more.
    const before = priced.diagnostics.economy?.availableVorp ?? 0;
    const after = floored.diagnostics.economy?.availableVorp ?? 0;
    expect(after).toBeLessThan(before);
    expect(floored.diagnostics.floorPositions).toEqual(["K"]);
  });

  test("REG 2026-09-18 — the board sorts by dollars where there are dollars, so a floored position cannot top it", () => {
    const config = deriveLeagueConfig(leagueFixture());
    const { index } = buildPlayerIndex(playersFixture());
    const state = summarizeLeagueState({ rosters: rostersFixture(), index, config, week: 2 });
    const weekly: WeeklyPoints[] = projectionsFixture()
      .filter((row) => index.has(row.player_id))
      .map((row) => ({
        playerId: row.player_id,
        week: row.week,
        points: scoreStatLine(row.stats, config.scoring),
      }));

    const board = buildWaiverBoard({
      config,
      index,
      state,
      weekly,
      throughWeek: THROUGH_WEEK,
      chopsPerWeek: 1,
      floorPositions: ["K"],
    });

    const values = board.rows.map((row) => row.value ?? 0);
    expect([...values].sort((a, b) => b - a)).toEqual(values);
  });
});
