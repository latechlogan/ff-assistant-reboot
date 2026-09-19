import { parseArgs } from "node:util";
import { buildWaiverBoard } from "../../core/board/build.ts";
import { deriveLeagueConfig } from "../../core/config/derive.ts";
import { buildPlayerIndex } from "../../core/players/index-players.ts";
import { scoreWeeklyRows } from "../../core/projections/weekly.ts";
import { summarizeLeagueState } from "../../core/rosters/state.ts";
import { UnsupportedLeagueError, type WeeklyPoints } from "../../core/types.ts";
import { createLogger } from "../obs/logger.ts";
import { SleeperClient } from "../sleeper/client.ts";
import { SleeperSource } from "../sleeper/sleeper.ts";
import { DataRootError, Store } from "../store/store.ts";

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
  if (error instanceof DataRootError) {
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
  const index = buildPlayerIndex(playersPayload.data);
  logger.log("debug", "players.indexed", { indexed: index.size });

  const leagueState = summarizeLeagueState({
    rosters: rostersPayload.data,
    index,
    config,
    week,
  });
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
  let unmatched = 0;
  for (let w = week; w <= LAST_NFL_WEEK; w++) {
    const projections = await source.weeklyProjections(season, w, policy);
    files.push(projections.file);
    // The counting and the warning live in the core, where a test can hold them to it.
    const scored = scoreWeeklyRows({
      rows: projections.data,
      index,
      scoring: config.scoring,
      logger,
    });
    weekly.push(...scored.weekly);
    unmatched += scored.unmatched;
  }

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
    belowReplacement: board.diagnostics.belowReplacement,
    replacement: board.diagnostics.replacement,
    economy: board.diagnostics.economy,
    inputs: files,
  });

  print(board, { index, config, leagueKey: entry.key, all: values.all });
}

function print(
  board: ReturnType<typeof buildWaiverBoard>,
  opts: {
    index: ReturnType<typeof buildPlayerIndex>;
    config: ReturnType<typeof deriveLeagueConfig>;
    leagueKey: string;
    all: boolean;
  },
): void {
  const { diagnostics } = board;
  const money = diagnostics.economy !== null;
  const rows = opts.all ? board.everyRow : board.rows.slice(0, 40);

  const header = [
    `${opts.leagueKey} — week ${diagnostics.week}, ${diagnostics.liveTeams} teams live`,
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
        `${diagnostics.belowReplacement} below it, not printed (--all prints every available player)`,
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
    console.log(
      `\nvalue = what he is worth · $${diagnostics.economy.dollarsPerVorp.toFixed(2)} per VORP ` +
        `over a season supply of ${diagnostics.economy.supply.toFixed(0)} VORP ` +
        `(${diagnostics.economy.chopsRemaining} chops still to come). ` +
        `\nIt is not what he will cost — a bid range comes later.`,
    );
  }
  console.log("");
}
