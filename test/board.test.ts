/**
 * Interface assumed by 007's tests (tickets/007, written before the implementation):
 *
 *   buildWaiverBoard(args) gains `unspentCurve?: UnspentCurve` — the measured curve,
 *     { byChopWeek: { week: number; mean: number }[]; survivorResidual: { mean: number } },
 *     as Store#readUnspentCurve returns it. A guillotine room with FAAB throws without
 *     it (message matching /curve|unspent|measured/i); a standard room never reads it.
 *     The budget is the league's own `config.waiver.budget`; the chop schedule is one
 *     chop per `chopsPerWeek` in each week from `state.week` through the priced
 *     `throughWeek`, `liveTeams − 1` chops in all.
 *   diagnostics.economy gains `leakage`, `reserve` and `releaseEquivalents` (see
 *     src/core/valuation/allocate.test.ts); `pool` stays the room's gross FAAB, and
 *     `distributable` is pool − leakage − reserve.
 *   boardArtifact carries those three fields into the frozen board.
 */
import { describe, expect, test } from "vitest";
import { boardArtifact, serializeBoard } from "../src/core/board/artifact.ts";
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
  /** A minimum bid for the room; the fixture league's own is $0. */
  minBid?: number;
};

function board(week = 2, extra: Extra = {}) {
  const league = leagueFixture();
  if (extra.minBid !== undefined) league.settings.waiver_bid_min = extra.minBid;
  const config = deriveLeagueConfig(league);
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
      unspentCurve: UNSPENT_CURVE,
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
  test("001 AC2 — a guillotine board refuses to guess the chop cadence", () => {
    const config = deriveLeagueConfig(leagueFixture());
    const { index } = buildPlayerIndex(playersFixture());
    const state = summarizeLeagueState({ rosters: rostersFixture(), index, config, week: 2 });

    // Sleeper publishes the format but not the cadence. Assuming one chop a week
    // would price a two-a-week room on a half-speed survival curve.
    expect(() =>
      buildWaiverBoard({ config, index, state, weekly: [], throughWeek: THROUGH_WEEK }),
    ).toThrow(/chopsPerWeek/);
  });

  test("001 AC1 — every row is an available player above replacement, priced in FAAB dollars", () => {
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

  test("001 AC7 — the printed dollars close over the rows that were priced, not over everyone", () => {
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

  test("001 AC8 — two runs over the same payloads produce identical boards", () => {
    expect(board().result).toEqual(board().result);
  });

  test("001 AC5 — a chopped roster's players are priced as available", () => {
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

  test("001 AC10 — the board says how many rows it left below replacement", () => {
    const { state, result } = board();

    expect(result.diagnostics.dropped.rowCount).toBe(
      state.availableIds.length - result.rows.length,
    );
    expect(result.diagnostics.availablePool).toBe(state.availableIds.length);
  });

  test("009 AC4 — replacement levels do not move when inactive players are in the payload", () => {
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
    /**
     * The committed fixture holds two live rosters, and since tickets/006 a two-team
     * room in week 2 is decided that same week: one priced week, so there is no later
     * week for the curve to discount. The guard is about the discount, not about the
     * fixture's size, so the room is cloned up to a count that still has weeks ahead
     * of it — the league's own `total_rosters`, never a number typed in here.
     */
    const config = deriveLeagueConfig(leagueFixture());
    const { index } = buildPlayerIndex(playersFixture());
    const template = rostersFixture().find((r) => r.settings.eliminated == null);
    expect(template).toBeDefined();
    const rosters = Array.from({ length: leagueFixture().total_rosters }, (_, i) => ({
      ...(template as NonNullable<typeof template>),
      roster_id: i + 1,
    }));
    const state = summarizeLeagueState({ rosters, index, config, week: 2 });

    const result = buildWaiverBoard({
      config,
      index,
      state,
      weekly: [],
      throughWeek: THROUGH_WEEK,
      chopsPerWeek: 1,
      unspentCurve: UNSPENT_CURVE,
    });

    const weights = result.diagnostics.survivalWeights;
    expect(weights).not.toBeNull();
    expect(weights?.length ?? 0).toBeGreaterThan(1); // the room has weeks ahead of it
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
    const args = {
      config,
      index,
      state,
      weekly,
      throughWeek: THROUGH_WEEK,
      chopsPerWeek: 1,
      unspentCurve: UNSPENT_CURVE,
    };

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
      unspentCurve: UNSPENT_CURVE,
    });

    const values = board.rows.map((row) => row.value ?? 0);
    expect([...values].sort((a, b) => b - a)).toEqual(values);
  });
});

/**
 * The frozen artifact (tickets/004): the board as it reaches disk, over the same real
 * fixtures the pipeline above uses. The store's own tests cover paths and refusals;
 * what is left to prove here is that the file accounts for every dollar and that the
 * clock is the only thing that moves between two runs.
 */
describe("the board as it is frozen", () => {
  const INPUTS = ["raw/2026/nfl-state--x.json", "raw/2026/league-chopped--x.json"];

  function artifact(generatedAt = "2026-09-22T15:00:00.000Z", extra: Extra = {}) {
    const { index, result, state } = board(2, extra);
    return {
      state,
      result,
      board: boardArtifact({
        board: result,
        index,
        leagueKey: "chopped",
        season: "2026",
        generatedAt,
        inputs: INPUTS,
      }),
    };
  }

  test("004 AC3 — the file holds only the decisions, and accounts for everything it left out", () => {
    const { state, result, board: frozen } = artifact();

    // Exactly the available players above replacement: the week's actual decisions.
    expect(frozen.rows).toHaveLength(result.rows.length);
    for (const row of frozen.rows) {
      expect(state.rosteredIds.has(row.playerId)).toBe(false);
      expect(row.vorp).toBeGreaterThan(0);
      expect(row.name).not.toBe(""); // a name, not an id — the file is read by a human
    }

    // And the pool it came out of is fully accounted for by the file alone.
    const dropped = frozen.diagnostics.dropped;
    expect(dropped.rowCount).toBe(frozen.diagnostics.availablePool - frozen.rows.length);
    expect(dropped.rowCount).toBeGreaterThan(0); // the fixtures do drop rows
    expect(dropped.valueSum).not.toBeNull(); // this league has FAAB
  });

  test("004 AC4 — the economy closes from the file alone", () => {
    const { board: frozen } = artifact();
    const { economy, dropped } = frozen.diagnostics;
    if (!economy) throw new Error("the fixture league has FAAB; this should not be null");

    const shown = frozen.rows.reduce((sum, row) => sum + (row.value ?? 0), 0);

    /**
     * The identity, stated in the file's own numbers. The floor every available
     * player is guaranteed is the recorded `reserve` — since tickets/007 no longer
     * `pool − distributable`, which now also holds the leakage; the rest is spread
     * over the whole season's supply, of which this week's available players are
     * `availableVorp / supply`. The remainder is not missing — it is held for the
     * rosters that future chops will release.
     */
    const reserve = economy.reserve;
    const expected = reserve + (economy.distributable * economy.availableVorp) / economy.supply;

    expect(shown + (dropped.valueSum ?? 0)).toBeCloseTo(expected, 2);
    // And nothing the board says anyone is worth can exceed the money in the room.
    expect(shown + (dropped.valueSum ?? 0)).toBeLessThanOrEqual(economy.pool);
  });

  test("004 AC3 — with a floor, every dropped row is worth exactly the floor, and the economy still closes", () => {
    // The fixture room and both live rooms bid from $0, where a dropped row is worth
    // $0 and a `valueSum` hardcoded to 0 would pass everything. A $1 floor makes the
    // dropped rows carry real money, so the sum has to be computed to be right.
    const minBid = 1;
    const { board: frozen } = artifact(undefined, { minBid });
    const { economy, dropped } = frozen.diagnostics;
    if (!economy) throw new Error("the fixture league has FAAB; this should not be null");

    expect(dropped.rowCount).toBeGreaterThan(0);
    expect(dropped.valueSum).toBeCloseTo(minBid * dropped.rowCount, 6);

    const shown = frozen.rows.reduce((sum, row) => sum + (row.value ?? 0), 0);
    const reserve = economy.reserve;
    expect(reserve).toBeCloseTo(minBid * frozen.diagnostics.availablePool, 6);
    expect(shown + (dropped.valueSum ?? 0)).toBeCloseTo(
      reserve + (economy.distributable * economy.availableVorp) / economy.supply,
      2,
    );
  });

  test("004 AC5 — two builds from the same inputs are byte-identical once generatedAt is removed", () => {
    const withoutClock = (json: string): string =>
      json.replace(/^\s*"generatedAt".*$/m, '"generatedAt": ""');

    const first = serializeBoard(artifact("2026-09-22T15:00:00.000Z").board);
    const second = serializeBoard(artifact("2026-09-23T04:31:59.999Z").board);

    expect(first).not.toBe(second); // the clock did move, or this proves nothing
    expect(withoutClock(first)).toBe(withoutClock(second));
  });

  test("004 AC2 — the envelope carries what a rebuild needs, and nothing it cannot name", () => {
    const { board: frozen } = artifact();

    expect(frozen.schemaVersion).toBeGreaterThan(0);
    expect(frozen.leagueKey).toBe("chopped");
    expect(frozen.season).toBe("2026");
    expect(frozen.week).toBe(frozen.diagnostics.week);
    expect(frozen.inputs).toEqual(INPUTS);
    // Serializing is where the outbound schema is enforced, so a board the schema
    // rejects can never reach a file.
    expect(() => serializeBoard({ ...frozen, week: -1 })).toThrow();
  });
});

/**
 * Ticket 007 — the economy over time, wired through the board.
 *
 * The allocation's own arithmetic is proved in src/core/valuation/allocate.test.ts on
 * the week-3 inputs. What is left here is that the board passes the curve and the chop
 * schedule through, says what it did in its diagnostics, and leaves a standard room alone.
 */

/** measured/chop-unspent-v1.json (../ff-assistant-data): byChopWeek[].mean and survivorResidual.mean. */
const UNSPENT_CURVE = {
  byChopWeek: [
    { week: 1, mean: 0.9998 },
    { week: 2, mean: 0.9578 },
    { week: 3, mean: 0.7777 },
    { week: 4, mean: 0.7453 },
    { week: 5, mean: 0.721 },
    { week: 6, mean: 0.673 },
    { week: 7, mean: 0.471 },
    { week: 8, mean: 0.2253 },
    { week: 9, mean: 0.2265 },
    { week: 10, mean: 0.1703 },
    { week: 11, mean: 0.1316 },
    { week: 12, mean: 0.0442 },
    { week: 13, mean: 0.1025 },
    { week: 14, mean: 0.0252 },
    { week: 15, mean: 0.0228 },
    { week: 16, mean: 0.02 },
    { week: 17, mean: 0.0075 },
  ],
  survivorResidual: { mean: 0.0182 },
};

function scoredWeekly(
  index: ReturnType<typeof buildPlayerIndex>["index"],
  config: ReturnType<typeof deriveLeagueConfig>,
) {
  return projectionsFixture()
    .filter((row) => index.has(row.player_id))
    .map((row) => ({
      playerId: row.player_id,
      week: row.week,
      points: scoreStatLine(row.stats, config.scoring),
    }));
}

/**
 * A full 16-team room in week 2, every roster alive — the fixture's live roster cloned up
 * to the league's own `total_rosters`, as the survival REG test above does. One chop a
 * week, so chops land in weeks 2–16 and the room is priced through week 16.
 */
function fullRoom(minBid?: number) {
  const league = leagueFixture();
  if (minBid !== undefined) league.settings.waiver_bid_min = minBid;
  const config = deriveLeagueConfig(league);
  const { index } = buildPlayerIndex(playersFixture());
  const template = rostersFixture().find((r) => r.settings.eliminated == null);
  if (!template) throw new Error("the fixture has a live roster");
  const rosters = Array.from({ length: league.total_rosters }, (_, i) => ({
    ...template,
    roster_id: i + 1,
  }));
  const state = summarizeLeagueState({ rosters, index, config, week: 2 });
  const result = buildWaiverBoard({
    config,
    index,
    state,
    weekly: scoredWeekly(index, config),
    throughWeek: THROUGH_WEEK,
    chopsPerWeek: 1,
    unspentCurve: UNSPENT_CURVE,
  });
  return { config, index, state, result };
}

describe("007 — the board prices the economy over time", () => {
  test("007 AC1 — the board's diagnostics state the releases in roster-equivalents, weighted by the weeks left", () => {
    const { state, result } = fullRoom();
    const d = result.diagnostics;
    const economy = d.economy;
    if (!economy) throw new Error("the fixture league has FAAB; this should not be null");

    expect(state.liveTeams).toBe(16);
    expect(d.throughWeek).toBe(16); // 15 chops, weeks 2–16

    // Independently: the release after the chop in the i-th priced week gets the share of
    // the survival-weighted weeks after it. The final chop's release gets nothing.
    const weights = d.survivalWeights ?? [];
    expect(weights).toHaveLength(15);
    const total = weights.reduce((sum, w) => sum + w, 0);
    let expected = 0;
    for (let i = 0; i < weights.length; i++) {
      expected += weights.slice(i + 1).reduce((sum, w) => sum + w, 0) / total;
    }

    expect(economy.releaseEquivalents).toBeCloseTo(expected, 10);
    expect(economy.releaseEquivalents).toBeLessThan(economy.chopsRemaining); // never whole rosters
    expect(economy.supply).toBeCloseTo(
      economy.availableVorp + economy.releaseEquivalents * economy.rosteredVorpPerTeam,
      6,
    );
  });

  test("007 AC2 — the board deducts each remaining chop's leakage and the survivor's, and keeps the gross pool", () => {
    const { config, state, result } = fullRoom();
    const economy = result.diagnostics.economy;
    if (!economy) throw new Error("the fixture league has FAAB; this should not be null");

    // Chops in weeks 2–16, one each, plus the survivor, at the league's own budget.
    const budget = config.waiver.budget ?? Number.NaN;
    const shares = UNSPENT_CURVE.byChopWeek
      .filter(({ week }) => week >= 2 && week <= 16)
      .reduce((sum, { mean }) => sum + mean, 0);
    const expectedLeakage = budget * (shares + UNSPENT_CURVE.survivorResidual.mean);

    expect(economy.pool).toBe(state.faabPool); // gross: what is actually in the room
    expect(economy.leakage).toBeCloseTo(expectedLeakage, 6);
    expect(economy.distributable).toBeCloseTo(economy.pool - economy.leakage, 6); // $0 floor
  });

  test("007 AC3 — a guillotine room with no curve is refused, not priced on a default", () => {
    const config = deriveLeagueConfig(leagueFixture());
    const { index } = buildPlayerIndex(playersFixture());
    const state = summarizeLeagueState({ rosters: rostersFixture(), index, config, week: 2 });

    expect(() =>
      buildWaiverBoard({
        config,
        index,
        state,
        weekly: scoredWeekly(index, config),
        throughWeek: THROUGH_WEEK,
        chopsPerWeek: 1,
      }),
    ).toThrow(/curve|unspent|measured/i);
  });

  test("007 AC3 — a FAAB room whose settings carry no budget is refused, not priced with zero leakage", () => {
    // The curve's shares are of a season budget. Normally a room without one has no
    // FAAB pool at all, but the build takes the config and the state separately, and a
    // mismatched pair must not turn `null × share` into $0 of leakage.
    const withBudget = deriveLeagueConfig(leagueFixture());
    const noBudget = leagueFixture();
    noBudget.settings.waiver_budget = null;
    const config = deriveLeagueConfig(noBudget);
    const { index } = buildPlayerIndex(playersFixture());
    const state = summarizeLeagueState({
      rosters: rostersFixture(),
      index,
      config: withBudget,
      week: 2,
    });
    expect(state.faabPool).not.toBeNull(); // or the refusal below is never reached

    expect(() =>
      buildWaiverBoard({
        config,
        index,
        state,
        weekly: scoredWeekly(index, config),
        throughWeek: THROUGH_WEEK,
        chopsPerWeek: 1,
        unspentCurve: UNSPENT_CURVE,
      }),
    ).toThrow(/no season budget/);
  });

  test("007 AC4 — the frozen board records pool, leakage, reserve and distributable, and both identities close", () => {
    // A $1 floor, so the reserve is a real term and differs from pool − distributable.
    const { index, result } = fullRoom(1);
    const frozen = boardArtifact({
      board: result,
      index,
      leagueKey: "chopped",
      season: "2026",
      generatedAt: "2026-09-22T15:00:00.000Z",
      inputs: ["raw/2026/nfl-state--x.json"],
    });
    const { economy, dropped, availablePool } = frozen.diagnostics;
    if (!economy) throw new Error("the fixture league has FAAB; this should not be null");

    expect(economy.leakage).toBeGreaterThan(0);
    expect(economy.reserve).toBeCloseTo(1 * availablePool, 6);
    expect(economy.distributable).toBeCloseTo(economy.pool - economy.leakage - economy.reserve, 2);

    const shown = frozen.rows.reduce((sum, row) => sum + (row.value ?? 0), 0);
    expect(shown + (dropped.valueSum ?? 0)).toBeCloseTo(
      economy.reserve + (economy.distributable * economy.availableVorp) / economy.supply,
      2,
    );
    // The file passes its own outbound gate with the new fields in it.
    expect(serializeBoard(frozen)).toContain('"leakage"');
  });
});

/**
 * AC6's "before": the standard room's every row as it priced BEFORE ticket 007, taken
 * from this build (commit 7bfbcc5) over the committed fixtures with the league's type
 * set to redraft, week 2, through week 18. Sorted by player id: [id, points, VORP].
 */
const STANDARD_BEFORE_007: readonly (readonly [string, number, number])[] = [
  ["10214", 0.757, 0],
  ["10955", 5.73, 0],
  ["11168", 1.003, 0],
  ["11560", 20.3634, 0],
  ["11586", 10.608, 0],
  ["11597", 3.4, 0],
  ["11623", 1.622, 0],
  ["11632", 13.803, 2.874],
  ["1166", 16.0604, 0],
  ["11792", 6.24, 0],
  ["12015", 7.03, 0.24],
  ["12185", 6.55, 0],
  ["12481", 13.257, 1.635],
  ["12487", 3.545, 0],
  ["12508", 20.8938, 0],
  ["12711", 6.74, 0],
  ["12718", 2.299, 0],
  ["12961", 6.5, 0],
  ["13270", 0.55, 0],
  ["13278", 1.094, 0],
  ["13285", 6.324, 0],
  ["13833", 6.01, 0],
  ["1945", 5.42, 0],
  ["2078", 2, 0],
  ["2133", 12.148, 1.219],
  ["3048", 0.304, 0],
  ["3257", 14.02, 0],
  ["3271", 1.704, 0],
  ["3678", 6.35, 0],
  ["4017", 16.283, 0],
  ["421", 20.3436, 0],
  ["4353", 0.1, 0],
  ["5189", 6.79, 0],
  ["6130", 3.877, 0],
  ["650", 6.72, 0],
  ["6744", 0, 0],
  ["6804", 23.5648, 1.932],
  ["6865", 5.35, 0],
  ["7090", 4.284, 0],
  ["7528", 1.159, 0],
  ["7562", 0.085, 0],
  ["7842", 2.432, 0],
  ["8131", 11.082, 1.076],
  ["8150", 17.011, 5.389],
  ["8161", 20.7006, 0],
  ["8195", 0.237, 0],
  ["8207", 0.793, 0],
  ["9226", 16.881, 5.259],
  ["9228", 19.4888, 0],
  ["9479", 3.696, 0],
  ["9484", 11.849, 1.843],
  ["9493", 20.119, 9.19],
  ["9508", 7.675, 0],
  ["96", 20.1438, 0],
  ["9756", 10.929, 0],
  ["9758", 21.6328, 0],
];

describe("007 — a standard room is left alone", () => {
  function standardRoom(unspentCurve?: unknown) {
    const league = leagueFixture();
    league.settings.type = 0; // redraft: the same room, not a guillotine
    const config = deriveLeagueConfig(league);
    const { index } = buildPlayerIndex(playersFixture());
    const state = summarizeLeagueState({ rosters: rostersFixture(), index, config, week: 2 });
    expect(config.format).toBe("standard");
    return buildWaiverBoard({
      config,
      index,
      state,
      weekly: scoredWeekly(index, config),
      throughWeek: THROUGH_WEEK,
      ...(unspentCurve === undefined ? {} : { unspentCurve: unspentCurve as typeof UNSPENT_CURVE }),
    });
  }

  test("007 AC6 — a standard room builds with no curve, and its rows, points and VORP are unchanged", () => {
    const result = standardRoom();

    const now = [...result.everyRow]
      .sort((a, b) => a.playerId.localeCompare(b.playerId))
      .map((row) => [row.playerId, row.points, row.vorp] as const);

    expect(now.map(([id]) => id)).toEqual(STANDARD_BEFORE_007.map(([id]) => id));
    now.forEach(([, points, vorp], i) => {
      const [, pointsBefore, vorpBefore] = STANDARD_BEFORE_007[i] ?? ["", NaN, NaN];
      expect(points).toBeCloseTo(pointsBefore, 6);
      expect(vorp).toBeCloseTo(vorpBefore, 6);
    });
    // The board's decisions are the same ten players.
    expect(result.rows.map((row) => row.playerId).sort()).toEqual(
      STANDARD_BEFORE_007.filter(([, , vorp]) => vorp > 0)
        .map(([id]) => id)
        .sort(),
    );
  });

  test("007 AC6 — a standard room never reads the curve, and nothing leaks from it", () => {
    // Any touch of this object — a property read, a spread, an `in` — fails the test.
    const trap = new Proxy(
      {},
      {
        get: () => {
          throw new Error("a standard room read the leakage curve");
        },
        has: () => {
          throw new Error("a standard room read the leakage curve");
        },
        ownKeys: () => {
          throw new Error("a standard room read the leakage curve");
        },
      },
    );

    const withTrap = standardRoom(trap);
    const without = standardRoom();

    expect(withTrap.everyRow).toEqual(without.everyRow);
    // No chops, no survivor: the pool it spreads is the room's FAAB, less only the floor.
    expect(without.diagnostics.economy?.leakage).toBe(0);
    expect(without.diagnostics.economy?.distributable).toBeCloseTo(
      (without.diagnostics.economy?.pool ?? NaN) - (without.diagnostics.economy?.reserve ?? NaN),
      10,
    );
  });
});
