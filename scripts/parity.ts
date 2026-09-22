/**
 * The one-time parity check (ticket 004): does the rewrite reproduce the old tool's
 * board, on the same week and the same inputs?
 *
 * Not part of `pnpm check`. It reads the private data repo and a board produced by
 * `../ff-assistant`, neither of which a test may depend on. It is run by hand, once,
 * and its finding is written into DECISIONS.md.
 *
 * It prices OUR side through the old tool's horizon (week 17 for the chopped room), so
 * that the horizon is not a difference. That is the only thing held equal by hand; every
 * other difference is a finding. The 17-vs-18 effect is then reported on its own, for
 * ticket 006.
 *
 *   pnpm parity --league chopped --week 3 [--through 17] [--old <path>] [--top 40]
 */
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { buildWaiverBoard } from "../src/core/board/build.ts";
import { deriveLeagueConfig } from "../src/core/config/derive.ts";
import { buildPlayerIndex } from "../src/core/players/index-players.ts";
import { scoreWeeklyRows } from "../src/core/projections/weekly.ts";
import { summarizeLeagueState } from "../src/core/rosters/state.ts";
import type { WeeklyPoints } from "../src/core/types.ts";
import { createLogger } from "../src/adapters/obs/logger.ts";
import {
  LeagueSchema,
  PlayerMapSchema,
  ProjectionsSchema,
  RostersSchema,
} from "../src/adapters/sleeper/schemas.ts";
import { Store } from "../src/adapters/store/store.ts";

const { values } = parseArgs({
  options: {
    league: { type: "string", default: "chopped" },
    week: { type: "string" },
    through: { type: "string", default: "17" },
    old: { type: "string" },
    top: { type: "string", default: "40" },
  },
});

/** The old tool's own last NFL week, for the horizon-effect column. */
const OUR_LAST_NFL_WEEK = 18;

type OldRow = {
  playerId: string;
  name: string;
  position: string;
  points: number;
  vorp: number;
  value: number;
};
type OldBoard = {
  leagueKey: string;
  season: string;
  week: number;
  generatedAt: string;
  diagnostics: {
    liveTeams: number;
    faabPool: number;
    indexSize: number;
    rosteredCount: number;
    availablePoolSize: number;
    horizon: { fromWeek: number; toWeek: number };
    vorp: { replacement: Record<string, number> };
    supply: { availableVorp: number; supply: number; dollarsPerVorp: number };
  };
  rows: OldRow[];
};

const store = new Store();
const { season } = store.leagues();
const entry = store.league(values.league ?? "chopped");
const logger = createLogger({ debug: false });

/** Every payload the board reads, from the as-of files already on disk — no network. */
function newest<T>(kind: string, parse: (raw: unknown) => T): { data: T; file: string } {
  const found = store.readNewestRaw<unknown>(season, kind);
  if (!found) throw new Error(`no as-of file for ${kind} — run the board once with --refresh`);
  return { data: parse(found.data), file: found.file };
}

const state = newest("nfl-state", (raw) => raw as { week: number });
const week = values.week ? Number(values.week) : state.data.week;
const wk = String(week).padStart(2, "0");

const leaguePayload = newest(`league-${entry.key}`, (raw) => LeagueSchema.parse(raw));
const rostersPayload = newest(`rosters-${entry.key}-wk${wk}`, (raw) => RostersSchema.parse(raw));
const playersPayload = newest("players-nfl", (raw) => PlayerMapSchema.parse(raw));

const config = deriveLeagueConfig(leaguePayload.data);
const index = buildPlayerIndex(playersPayload.data);
const leagueState = summarizeLeagueState({
  rosters: rostersPayload.data,
  index,
  config,
  week,
});

const weekly: WeeklyPoints[] = [];
const inputs = [state.file, leaguePayload.file, rostersPayload.file, playersPayload.file];
for (let w = week; w <= OUR_LAST_NFL_WEEK; w++) {
  const projections = newest(`projections-wk${String(w).padStart(2, "0")}`, (raw) =>
    ProjectionsSchema.parse(raw),
  );
  inputs.push(projections.file);
  const scored = scoreWeeklyRows({
    rows: projections.data,
    index,
    scoring: config.scoring,
    logger,
  });
  weekly.push(...scored.weekly);
}

function ourBoard(throughWeek: number) {
  return buildWaiverBoard({
    config,
    index,
    state: leagueState,
    weekly,
    throughWeek,
    ...(entry.chopsPerWeek === undefined ? {} : { chopsPerWeek: entry.chopsPerWeek }),
    ...(entry.floorPositions === undefined ? {} : { floorPositions: entry.floorPositions }),
  });
}

const throughWeek = Number(values.through);
const ours = ourBoard(throughWeek);
const oursOurHorizon = ourBoard(OUR_LAST_NFL_WEEK);

const oldPath =
  values.old ?? `../ff-assistant/data/snapshots/waivers/${season}-wk${wk}-${entry.key}.json`;
const old = JSON.parse(readFileSync(oldPath, "utf8")) as OldBoard;

const money = (n: number | null): string =>
  n === null ? "     —" : `$${n.toFixed(2)}`.padStart(9);
const num = (n: number, width = 9): string => n.toFixed(2).padStart(width);
const delta = (a: number, b: number): string => {
  const d = a - b;
  return `${d >= 0 ? "+" : ""}${d.toFixed(2)}`.padStart(9);
};

console.log(`\nPARITY — ${entry.key}, week ${week}`);
console.log(`  ours   : priced through week ${throughWeek}, from ${inputs.length} as-of files`);
console.log(`  theirs : ${oldPath}`);
console.log(
  `           generated ${old.generatedAt}, horizon ${old.diagnostics.horizon.fromWeek}-${old.diagnostics.horizon.toWeek}`,
);

console.log(`\nINPUTS (if these disagree, the two tools priced different rooms)`);
const inputRows: [string, number, number][] = [
  ["live teams", leagueState.liveTeams, old.diagnostics.liveTeams],
  ["FAAB pool", leagueState.faabPool ?? 0, old.diagnostics.faabPool],
  ["available pool", leagueState.availableIds.length, old.diagnostics.availablePoolSize],
  ["rostered", leagueState.rosteredIds.size, old.diagnostics.rosteredCount],
  ["indexed players", index.size, old.diagnostics.indexSize],
];
console.log(`  ${"".padEnd(16)}${"ours".padStart(12)}${"theirs".padStart(12)}${"Δ".padStart(10)}`);
for (const [label, a, b] of inputRows) {
  console.log(
    `  ${label.padEnd(16)}${String(a).padStart(12)}${String(b).padStart(12)}${delta(a, b)}`,
  );
}

console.log(`\nREPLACEMENT LEVEL and the exchange rate`);
console.log(`  ${"".padEnd(16)}${"ours".padStart(12)}${"theirs".padStart(12)}${"Δ".padStart(10)}`);
for (const [position, level] of Object.entries(ours.diagnostics.replacement)) {
  const theirs = old.diagnostics.vorp.replacement[position] ?? 0;
  console.log(`  ${position.padEnd(16)}${num(level, 12)}${num(theirs, 12)}${delta(level, theirs)}`);
}
const economy = ours.diagnostics.economy;
if (economy) {
  const pairs: [string, number, number][] = [
    ["available VORP", economy.availableVorp, old.diagnostics.supply.availableVorp],
    ["season supply", economy.supply, old.diagnostics.supply.supply],
    ["$ per VORP", economy.dollarsPerVorp, old.diagnostics.supply.dollarsPerVorp],
  ];
  for (const [label, a, b] of pairs) {
    console.log(`  ${label.padEnd(16)}${num(a, 12)}${num(b, 12)}${delta(a, b)}`);
  }
}

// The compared population is the positive-VORP rows: what each tool put on its board.
const oursById = new Map(ours.rows.map((row) => [row.playerId, row]));
const theirsById = new Map(old.rows.map((row) => [row.playerId, row]));
const everyId = [...new Set([...oursById.keys(), ...theirsById.keys()])];

const TOLERANCE = 0.01;
let breaches = 0;
console.log(
  `\nROWS — ${ours.rows.length} ours, ${old.rows.length} theirs, ${everyId.length} in the union`,
);
console.log(
  `  ${"PLAYER".padEnd(24)}${"POS".padEnd(4)}${"Δ points".padStart(10)}${"Δ vorp".padStart(10)}${"Δ value".padStart(10)}   note`,
);

const rows = everyId
  .map((playerId) => {
    const a = oursById.get(playerId);
    const b = theirsById.get(playerId);
    const name = index.get(playerId)?.name ?? b?.name ?? playerId;
    const position = a?.position ?? b?.position ?? "?";
    const note = a === undefined ? "ONLY THEIRS" : b === undefined ? "ONLY OURS" : "";
    const dPoints = (a?.points ?? 0) - (b?.points ?? 0);
    const dVorp = (a?.vorp ?? 0) - (b?.vorp ?? 0);
    const dValue = (a?.value ?? 0) - (b?.value ?? 0);
    return { name, position, dPoints, dVorp, dValue, note, rank: a?.value ?? b?.value ?? 0 };
  })
  .sort((x, y) => y.rank - x.rank);

for (const row of rows.slice(0, Number(values.top))) {
  const off =
    Math.abs(row.dPoints) > TOLERANCE ||
    Math.abs(row.dVorp) > TOLERANCE ||
    Math.abs(row.dValue) > TOLERANCE ||
    row.note !== "";
  if (off) breaches += 1;
  console.log(
    `  ${row.name.slice(0, 23).padEnd(24)}${row.position.padEnd(4)}${delta(row.dPoints + 0, 0).padStart(10)}${delta(row.dVorp, 0).padStart(10)}${delta(row.dValue, 0).padStart(10)}   ${row.note}`,
  );
}
for (const row of rows.slice(Number(values.top))) {
  if (
    Math.abs(row.dPoints) > TOLERANCE ||
    Math.abs(row.dVorp) > TOLERANCE ||
    Math.abs(row.dValue) > TOLERANCE ||
    row.note !== ""
  ) {
    breaches += 1;
  }
}

console.log(
  `\n  ${breaches === 0 ? "PARITY PASSES" : `${breaches} of ${rows.length} row(s) differ by more than ${TOLERANCE}`}`,
);

// What the horizon alone is worth, for ticket 006: our own board at 17 vs at 18.
console.log(
  `\nHORIZON EFFECT — our board at week ${throughWeek} vs ${OUR_LAST_NFL_WEEK} (ticket 006)`,
);
const at18 = new Map(oursOurHorizon.rows.map((row) => [row.playerId, row]));
console.log(
  `  ${"PLAYER".padEnd(24)}${"POS".padEnd(4)}${`value@${throughWeek}`.padStart(10)}${`value@${OUR_LAST_NFL_WEEK}`.padStart(10)}${"Δ".padStart(10)}`,
);
for (const row of ours.rows.slice(0, 10)) {
  const other = at18.get(row.playerId);
  console.log(
    `  ${(index.get(row.playerId)?.name ?? row.playerId).slice(0, 23).padEnd(24)}${row.position.padEnd(4)}${money(row.value)}${money(other?.value ?? null)}${delta(row.value ?? 0, other?.value ?? 0)}`,
  );
}
console.log("");
