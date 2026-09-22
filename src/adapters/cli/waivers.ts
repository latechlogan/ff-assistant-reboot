import { parseArgs } from "node:util";
import { BoardSchemaError, boardArtifact } from "../../core/board/artifact.ts";
import { buildWaiverBoard } from "../../core/board/build.ts";
import { claimsHaveCleared } from "../../core/claims/cleared.ts";
import { deriveLeagueConfig } from "../../core/config/derive.ts";
import { buildPlayerIndex } from "../../core/players/index-players.ts";
import {
  mergeUnmatched,
  scoreWeeklyRows,
  warnInactiveWithPoints,
  type InactiveWithPoints,
  type ScoredWeek,
} from "../../core/projections/weekly.ts";
import { assertChopCadence, summarizeLeagueState } from "../../core/rosters/state.ts";
import {
  ChopCadenceError,
  SeasonDecidedError,
  UnsupportedLeagueError,
  type PlayerIndex,
  type WeeklyPoints,
} from "../../core/types.ts";
import { createLogger } from "../obs/logger.ts";
import { SleeperClient } from "../sleeper/client.ts";
import { SleeperSource } from "../sleeper/sleeper.ts";
import { BoardLockedError, DataRootError, Store, type LeagueEntry } from "../store/store.ts";

/**
 * The Tuesday board (docs/architecture.md, "When Logan runs the Tuesday board").
 *
 * One league per invocation, so a run's output, exit code and artifacts describe
 * exactly one league. This file owns I/O, flags and rendering, and does no arithmetic
 * on a dollar — every number on screen came out of the core.
 */

/** NFL fact, not a league setting: the regular season is 18 weeks. */
const LAST_NFL_WEEK = 18;

const { values } = parseArgs({
  options: {
    league: { type: "string" },
    week: { type: "string" },
    refresh: { type: "boolean", default: false },
    all: { type: "boolean", default: false },
    debug: { type: "boolean", default: false },
  },
});

const logger = createLogger({ debug: values.debug });

try {
  await main();
} catch (error) {
  if (error instanceof UnsupportedLeagueError) {
    logger.log("error", "league.unsupported", { reason: error.reason });
    console.error(`\n${error.message}\n`);
    process.exit(2);
  }
  // Not a failure: the season is over, so there is no board to print and nothing went
  // wrong. Exit 0 and say which week decided it.
  if (error instanceof SeasonDecidedError) {
    logger.log("info", "league.decided", { decidedInWeek: error.decidedInWeek });
    console.log(`\nseason decided in week ${error.decidedInWeek} — no board to price.\n`);
    process.exit(0);
  }
  if (error instanceof ChopCadenceError) {
    logger.log("error", "league.cadence", { message: error.message });
    console.error(`\n${error.message}\n`);
    process.exit(2);
  }
  // The outbound schema refused the envelope, so nothing was written. Say what, and
  // spare the reader a stack trace through Zod.
  if (error instanceof BoardSchemaError) {
    logger.log("error", "board.schema", { message: error.message });
    console.error(`\n${error.message}\n`);
    process.exit(2);
  }
  if (error instanceof DataRootError || error instanceof BoardLockedError) {
    console.error(`\n${error.message}\n`);
    process.exit(2);
  }
  throw error;
}

async function main(): Promise<void> {
  const store = new Store();
  const { season } = store.leagues();

  if (values.league === undefined) {
    const keys = store.leagues().leagues.map((l) => l.key);
    console.error(`\n--league is required. Configured leagues: ${keys.join(", ")}\n`);
    process.exit(2);
  }
  const entry = store.league(values.league);

  const source = new SleeperSource(store, new SleeperClient({ logger }), logger);
  // --refresh means fresh data: falling back to an older payload while claiming to be
  // current is worse than no board at all.
  const policy = { refresh: values.refresh, requireFresh: values.refresh };

  const state = await source.nflState(season, policy);
  const week = values.week ? Number(values.week) : state.data.week;
  const files: string[] = [state.file];

  const leaguePayload = await source.league(season, entry.key, entry.leagueId, policy);
  const rostersPayload = await source.rosters(season, entry.key, entry.leagueId, week, policy);
  const playersPayload = await source.playerMap(season, policy);
  files.push(leaguePayload.file, rostersPayload.file, playersPayload.file);

  const config = deriveLeagueConfig(leaguePayload.data);
  const { index, inactive } = buildPlayerIndex(playersPayload.data);
  logger.log("debug", "players.indexed", { indexed: index.size, skippedInactive: inactive.size });

  const leagueState = summarizeLeagueState({
    rosters: rostersPayload.data,
    index,
    config,
    week,
  });
  // A count that disagrees with the cadence means we are reading Sleeper wrong; the
  // board would look fine and be off on every row. A missing cadence is refused below.
  if (entry.chopsPerWeek !== undefined) {
    assertChopCadence({ config, state: leagueState, chopsPerWeek: entry.chopsPerWeek });
  }
  logger.log("debug", "rosters.summarized", {
    liveTeams: leagueState.liveTeams,
    choppedTeams: leagueState.choppedTeams,
    rostered: leagueState.rosteredIds.size,
    available: leagueState.availableIds.length,
    faabPool: leagueState.faabPool,
  });

  // Rest-of-season means every week still to come, each scored under this league's
  // own rules. One payload per week, each an as-of file.
  const weekly: WeeklyPoints[] = [];
  const scoredWeeks: ScoredWeek[] = [];
  let unmatched = 0;
  const inactiveWithPoints: InactiveWithPoints[] = [];
  for (let w = week; w <= LAST_NFL_WEEK; w++) {
    const projections = await source.weeklyProjections(season, w, policy);
    files.push(projections.file);
    // The counting and the warning live in the core, where a test can hold them to it.
    const scored = scoreWeeklyRows({
      rows: projections.data,
      index,
      scoring: config.scoring,
      inactive,
      logger,
    });
    weekly.push(...scored.weekly);
    scoredWeeks.push(scored);
    unmatched += scored.unmatched;
    inactiveWithPoints.push(...scored.inactiveWithPoints);
  }
  // Both after the loop, so a player who scores in ten weeks is named once rather than
  // ten times, and the report is the run's, not fifteen copies of one week's.
  warnInactiveWithPoints(inactiveWithPoints, logger);
  const neverMatched = mergeUnmatched(scoredWeeks);

  const board = buildWaiverBoard({
    config,
    index,
    state: leagueState,
    weekly,
    throughWeek: LAST_NFL_WEEK,
    ...(entry.chopsPerWeek === undefined ? {} : { chopsPerWeek: entry.chopsPerWeek }),
    ...(entry.floorPositions === undefined ? {} : { floorPositions: entry.floorPositions }),
  });
  logger.log("debug", "board.built", {
    rows: board.rows.length,
    unmatchedRows: unmatched,
    dropped: board.diagnostics.dropped,
    replacement: board.diagnostics.replacement,
    economy: board.diagnostics.economy,
    inputs: files,
  });

  print(board, {
    index,
    config,
    leagueKey: entry.key,
    all: values.all,
    skippedInactive: inactive.size,
    neverMatched,
  });

  // The table is the answer; the file is the record. Freezing comes last so that a
  // refusal to overwrite still leaves the board on screen — the numbers were never
  // the thing in doubt, only whether they may replace a record already acted on.
  await freeze({
    board,
    index,
    season,
    week,
    currentWeek: state.data.week,
    entry,
    inputs: files,
    store,
    source,
  });
}

/**
 * Write this week's board to the data repo (tickets/004, AC1 and AC6).
 *
 * Two rules, and both are about not destroying a record:
 *
 *   - Only the CURRENT week is frozen. `--week 2` is a look back, and re-pricing a
 *     past week today with today's projections would overwrite the record of what was
 *     actually known on the Tuesday it mattered.
 *   - An existing board may be replaced only while that week's claims are still
 *     pending. Once the waiver run has processed them, the board describes a decision
 *     that has already been acted on, and the run refuses and exits non-zero.
 */
async function freeze(args: {
  board: ReturnType<typeof buildWaiverBoard>;
  index: PlayerIndex;
  season: string;
  week: number;
  currentWeek: number;
  entry: LeagueEntry;
  inputs: readonly string[];
  store: Store;
  source: SleeperSource;
}): Promise<void> {
  const { board, index, season, week, currentWeek, entry, inputs, store, source } = args;

  if (week !== currentWeek) {
    console.log(
      `not frozen: week ${week} is not the current week (${currentWeek}). ` +
        `A past week's board is a record of what was known then, and this run is not it.\n`,
    );
    return;
  }

  const key = { season, week, leagueKey: entry.key };
  const alreadyFrozen = store.hasBoard(key);

  if (alreadyFrozen) {
    // Asked fresh, every time. A cached copy pulled before the waiver run would say
    // "not cleared" for the rest of the week, which is the one answer that lets a
    // record be destroyed. A failed fetch fails the run rather than guessing.
    const transactions = await source.transactions(season, entry.key, entry.leagueId, week, {
      refresh: true,
      requireFresh: true,
    });
    if (claimsHaveCleared(transactions.data)) {
      logger.log("error", "board.locked", {
        file: store.boardPath(key),
        transactions: transactions.file,
      });
      console.error(
        `\nREFUSED to overwrite ${store.boardPath(key)}: week ${week}'s waiver claims have ` +
          `already cleared, so that board is the record of a decision that has been acted on.\n`,
      );
      process.exit(2);
    }
  }

  const artifact = boardArtifact({
    board,
    index,
    leagueKey: entry.key,
    season,
    // The clock is read here and nowhere in the core, which is what lets two runs
    // over the same as-of files differ in this field and in nothing else.
    generatedAt: new Date().toISOString(),
    /**
     * Every as-of file the run read to price the board, so it can be rebuilt after
     * the rosters have moved on. A superset of what the numbers used: projections are
     * fetched to the NFL's last week, and a guillotine room stops at the week of its
     * final chop (tickets/006), which `diagnostics.throughWeek` names.
     *
     * The guard's transactions payload is deliberately NOT among them: no row was
     * priced from it, and naming a file whose timestamp differs between two runs
     * would make the record's own inputs non-reproducible.
     */
    inputs,
  });

  const written = store.writeBoard(artifact, { overwrite: alreadyFrozen });
  console.log(`${written.overwrote ? "OVERWROTE" : "FROZE"} ${written.file}\n`);
}

function print(
  board: ReturnType<typeof buildWaiverBoard>,
  opts: {
    index: PlayerIndex;
    config: ReturnType<typeof deriveLeagueConfig>;
    leagueKey: string;
    all: boolean;
    /** Players Sleeper calls inactive, left out of the index (ticket 009). */
    skippedInactive: number;
    neverMatched: ReturnType<typeof mergeUnmatched>;
  },
): void {
  const { diagnostics } = board;
  const money = diagnostics.economy !== null;
  const rows = opts.all ? board.everyRow : board.rows.slice(0, 40);

  const header = [
    `${opts.leagueKey} — week ${diagnostics.week}, ${diagnostics.liveTeams} teams live`,
    // The skipped count sits next to the pool it was taken out of, so the numbers
    // below it are checkable rather than merely printed (ticket 009).
    `${opts.index.size} indexed (${opts.skippedInactive} inactive skipped), ` +
      `${diagnostics.availablePool} available, ${board.rows.length} above replacement`,
    money
      ? `$${Math.round(diagnostics.economy?.pool ?? 0)} FAAB left in the room`
      : "no FAAB currency — points and VORP only",
  ].join(" · ");

  console.log(`\n${header}\n`);
  console.log(
    ["POS".padEnd(4), "PLAYER".padEnd(24), "PTS".padStart(7), "VORP".padStart(7)]
      .concat(money ? ["VALUE".padStart(8)] : [])
      .join(" "),
  );

  for (const row of rows) {
    const player = opts.index.get(row.playerId);
    console.log(
      [
        row.position.padEnd(4),
        (player?.name ?? row.playerId).slice(0, 24).padEnd(24),
        row.points.toFixed(1).padStart(7),
        row.vorp.toFixed(1).padStart(7),
      ]
        .concat(money ? [`$${(row.value ?? 0).toFixed(0)}`.padStart(8)] : [])
        .join(" "),
    );
  }

  if (!opts.all) {
    const hidden = board.rows.length - rows.length;
    console.log(
      `\n${hidden > 0 ? `… ${hidden} more above replacement, and ` : "… "}` +
        `${diagnostics.dropped.rowCount} below it, not printed (--all prints every available player)`,
    );
  }
  if (diagnostics.floorPositions.length > 0) {
    console.log(
      `\n${diagnostics.floorPositions.join(", ")} priced at the floor: real points, no real market ` +
        `(23 guillotine rooms, 2025 — the top weekly bids were RB, WR, QB and TE, never a K).`,
    );
  }
  // Said plainly, every run: what a dollar buys on average over the rest of the season.
  if (diagnostics.economy) {
    // A survival curve is what makes a room a guillotine, and only a guillotine room
    // has a week it gets decided in. Both numbers are the board's; the CLI does no
    // arithmetic of its own.
    const season =
      diagnostics.survivalWeights === null
        ? ""
        : `\nseason decided in week ${diagnostics.throughWeek}: ` +
          `${diagnostics.economy.chopsRemaining} release(s) left that a priced week can still use.`;
    console.log(
      `\nvalue = what he is worth · $${diagnostics.economy.dollarsPerVorp.toFixed(2)} per VORP ` +
        `over a season supply of ${diagnostics.economy.supply.toFixed(0)} VORP.` +
        season +
        `\nIt is not what he will cost — a bid range comes later.`,
    );
  }
  // Printed every run, empty or not: a diagnostic that only appears when it fires is
  // one nobody learns to read, and this silence already cost every kicker 20% once.
  const { unmatchedRules, unmatchedStats } = opts.neverMatched;
  const named = (keys: readonly string[]): string => (keys.length > 0 ? keys.join(", ") : "none");
  console.log(
    `\nnever scored, across every week priced` +
      `\n  league rules no stat key reached: ${named(unmatchedRules)}` +
      `\n  stat keys no league rule scored: ${named(unmatchedStats)}`,
  );
  console.log("");
}
