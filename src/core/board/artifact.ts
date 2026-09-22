import { z } from "zod";
import { PRICED_POSITIONS, type PlayerIndex } from "../types.ts";
import type { WaiverBoard } from "./build.ts";

/**
 * The frozen board: one league-week, as it reaches disk (docs/data-model.md, `BOARD`).
 *
 * It is a **record, not an input**. Nothing in the pricing path reads one back — the
 * reader here exists for Logan, for tests, and for later analysis. Reading a frozen
 * board to price a later week would make a run depend on its own past output, which
 * is exactly the reproducibility the as-of rules buy.
 *
 * Two things make a record trustworthy years later, and both are enforced here rather
 * than hoped for:
 *
 *   1. It says what it was built from — `inputs` names every as-of file the run read,
 *      so the same board can be rebuilt after the rosters have moved on.
 *   2. It carries `schemaVersion`, and a reader meeting an unknown one refuses loudly
 *      rather than parsing the half it happens to recognize.
 *
 * `generatedAt` and `inputs` are stamped by the CLI. This module reads no clock and no
 * file — it only shapes, validates and serializes.
 */

/** Bumped when the board's own shape changes. A reader that meets an unknown one refuses. */
export const BOARD_SCHEMA_VERSION = 1;

const BoardRowSchema = z.object({
  playerId: z.string().min(1),
  /** The name, not just the id: this file is read by a human, sometimes months later. */
  name: z.string().min(1),
  team: z.string().nullable(),
  position: z.enum(PRICED_POSITIONS),
  points: z.number(),
  vorp: z.number(),
  /** FAAB dollars; null in a league with no currency to price in. */
  value: z.number().nullable(),
});

const EconomySchema = z.object({
  pool: z.number(),
  distributable: z.number(),
  availableVorp: z.number(),
  rosteredVorpPerTeam: z.number(),
  chopsRemaining: z.number(),
  supply: z.number(),
  dollarsPerVorp: z.number(),
});

const DiagnosticsSchema = z.object({
  week: z.number().int().positive(),
  throughWeek: z.number().int().positive(),
  liveTeams: z.number().int().nonnegative(),
  choppedTeams: z.number().int().nonnegative(),
  availablePool: z.number().int().nonnegative(),
  replacement: z.record(z.enum(PRICED_POSITIONS), z.number()),
  survivalWeights: z.array(z.number()).nullable(),
  floorPositions: z.array(z.enum(PRICED_POSITIONS)),
  economy: EconomySchema.nullable(),
  dropped: z.object({
    rowCount: z.number().int().nonnegative(),
    valueSum: z.number().nullable(),
  }),
});

export const BoardSchema = z.object({
  schemaVersion: z.literal(BOARD_SCHEMA_VERSION),
  leagueKey: z.string().min(1),
  season: z.string().regex(/^\d{4}$/),
  week: z.number().int().positive(),
  generatedAt: z.iso.datetime(),
  /** Data-root-relative paths of every as-of file the run priced from. */
  inputs: z.array(z.string().min(1)).min(1),
  diagnostics: DiagnosticsSchema,
  /** Only the decisions: the available players above replacement. */
  rows: z.array(BoardRowSchema),
});

export type Board = z.infer<typeof BoardSchema>;
export type BoardRow = z.infer<typeof BoardRowSchema>;

/** Raised when a board does not match the shape this build writes and reads. */
export class BoardSchemaError extends Error {}

/** Raised when a board's dollars do not add up to the economy it says it came from. */
export class BoardEconomyError extends Error {}

/**
 * Shape a priced board into the artifact, joining each row to the player's name.
 *
 * Pure: the caller supplies `generatedAt` and `inputs`, because the core reads no
 * clock and knows no filesystem.
 */
export function boardArtifact(args: {
  board: WaiverBoard;
  index: PlayerIndex;
  leagueKey: string;
  season: string;
  generatedAt: string;
  inputs: readonly string[];
}): Board {
  const { board, index, leagueKey, season, generatedAt, inputs } = args;
  const d = board.diagnostics;

  return {
    schemaVersion: BOARD_SCHEMA_VERSION,
    leagueKey,
    season,
    week: d.week,
    generatedAt,
    inputs: [...inputs],
    diagnostics: {
      week: d.week,
      throughWeek: d.throughWeek,
      liveTeams: d.liveTeams,
      choppedTeams: d.choppedTeams,
      availablePool: d.availablePool,
      replacement: { ...d.replacement },
      survivalWeights: d.survivalWeights === null ? null : [...d.survivalWeights],
      floorPositions: [...d.floorPositions],
      economy: d.economy === null ? null : { ...d.economy },
      dropped: { ...d.dropped },
    },
    rows: board.rows.map((row) => {
      const player = index.get(row.playerId);
      // Every priced row came out of the index, so a miss is a bug upstream. Writing
      // the id in place of a name would freeze that bug into a permanent record.
      if (!player) throw new BoardSchemaError(`priced player ${row.playerId} is not in the index`);
      return {
        playerId: row.playerId,
        name: player.name,
        team: player.team,
        position: row.position,
        points: row.points,
        vorp: row.vorp,
        value: row.value,
      };
    }),
  };
}

/**
 * The outbound gate: validate, then serialize. Nothing is written that did not pass.
 *
 * Serializing from the *parsed* value is what makes two runs byte-identical — the
 * schema fixes the key order and drops anything it does not name, so the file cannot
 * inherit whatever order an object literal happened to be built in.
 */
export function serializeBoard(board: Board): string {
  const parsed = BoardSchema.safeParse(board);
  if (!parsed.success) {
    throw new BoardSchemaError(
      `this board does not match board schema version ${BOARD_SCHEMA_VERSION}, ` +
        `so nothing was written:\n${parsed.error.message}`,
    );
  }
  return JSON.stringify(parsed.data, null, 2) + "\n";
}

/** A dollar of slack: the sums below run over thousands of floats. */
const TOLERANCE = 0.01;

/**
 * Does the board's money add up to the economy it says it came from? (tickets/004, AC4.)
 *
 * The file keeps only the positive-VORP rows, so without `dropped.valueSum` the rest
 * of the money would simply be absent and the file could not be checked. With it, the
 * identity closes in the file's own numbers:
 *
 *     Σ value(rows) + dropped.valueSum  =  reserve + distributable × availableVorp / supply
 *
 * where `reserve` (= pool − distributable) is the floor every available player is
 * guaranteed. The right-hand side is smaller than the pool on purpose: a dollar is
 * spread over the whole season's supply, and this week's available players are only
 * `availableVorp / supply` of it. The remainder is not missing — it is what the
 * rosters released by future chops are worth.
 *
 * The 2026 tool's version was "= distributable", true only while supply was this
 * week's pool alone; tickets/004's AC4 was amended to this form (DECISIONS.md,
 * 2026-09-22).
 */
export function assertEconomyCloses(board: Board, where: string): void {
  const { economy, dropped } = board.diagnostics;
  // No FAAB, no economy and no dollars on any row: nothing to close.
  if (economy === null) return;

  const shown = board.rows.reduce((sum, row) => sum + (row.value ?? 0), 0);
  const actual = shown + (dropped.valueSum ?? 0);
  const reserve = economy.pool - economy.distributable;
  const expected =
    economy.supply > 0
      ? reserve + (economy.distributable * economy.availableVorp) / economy.supply
      : reserve;

  if (Math.abs(actual - expected) > TOLERANCE) {
    throw new BoardEconomyError(
      `the economy in ${where} does not close: its rows and dropped rows total ` +
        `${actual.toFixed(2)}, but a pool of ${economy.pool.toFixed(2)} over a supply of ` +
        `${economy.supply.toFixed(2)} makes them worth ${expected.toFixed(2)}. ` +
        `A board whose dollars do not add up is not a record of anything.`,
    );
  }
}
