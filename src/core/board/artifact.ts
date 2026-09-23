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

/**
 * Bumped when the board's own shape changes. A reader that meets an unknown one refuses.
 *
 * 2 (tickets/007): the economy records `leakage`, `reserve` and `releaseEquivalents`.
 * Version 1 boards are still read, under their own identity — they are records, and a
 * record the tool that wrote it can no longer open is not much of one.
 */
export const BOARD_SCHEMA_VERSION = 2;

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

const EconomyV1Schema = z.object({
  pool: z.number(),
  distributable: z.number(),
  availableVorp: z.number(),
  rosteredVorpPerTeam: z.number(),
  chopsRemaining: z.number(),
  supply: z.number(),
  dollarsPerVorp: z.number(),
});

/** The key order here is the order on disk: gross pool, what comes out of it, what is left. */
const EconomySchema = z.object({
  pool: z.number(),
  leakage: z.number(),
  reserve: z.number(),
  distributable: z.number(),
  availableVorp: z.number(),
  rosteredVorpPerTeam: z.number(),
  chopsRemaining: z.number(),
  releaseEquivalents: z.number(),
  supply: z.number(),
  dollarsPerVorp: z.number(),
});

const diagnosticsWith = <E extends z.ZodType>(economy: E) =>
  z.object({
    week: z.number().int().positive(),
    throughWeek: z.number().int().positive(),
    liveTeams: z.number().int().nonnegative(),
    choppedTeams: z.number().int().nonnegative(),
    availablePool: z.number().int().nonnegative(),
    replacement: z.record(z.enum(PRICED_POSITIONS), z.number()),
    survivalWeights: z.array(z.number()).nullable(),
    floorPositions: z.array(z.enum(PRICED_POSITIONS)),
    economy: economy.nullable(),
    dropped: z.object({
      rowCount: z.number().int().nonnegative(),
      valueSum: z.number().nullable(),
    }),
  });

const envelopeWith = <V extends number, E extends z.ZodType>(version: V, economy: E) =>
  z.object({
    schemaVersion: z.literal(version),
    leagueKey: z.string().min(1),
    season: z.string().regex(/^\d{4}$/),
    week: z.number().int().positive(),
    generatedAt: z.iso.datetime(),
    /** Data-root-relative paths of every as-of file the run priced from. */
    inputs: z.array(z.string().min(1)).min(1),
    diagnostics: diagnosticsWith(economy),
    /** Only the decisions: the available players above replacement. */
    rows: z.array(BoardRowSchema),
  });

export const BoardSchema = envelopeWith(BOARD_SCHEMA_VERSION, EconomySchema);
/** Read-only: boards frozen before tickets/007. Nothing writes this shape any more. */
export const BoardV1Schema = envelopeWith(1, EconomyV1Schema);

export type Board = z.infer<typeof BoardSchema>;
export type BoardV1 = z.infer<typeof BoardV1Schema>;
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
 * Does the board's money add up to the economy it says it came from? (tickets/004 AC4,
 * tickets/007 AC4.)
 *
 * The file keeps only the positive-VORP rows, so without `dropped.valueSum` the rest
 * of the money would simply be absent and the file could not be checked. With it, two
 * identities close in the file's own numbers:
 *
 *     distributable                     =  pool − leakage − reserve
 *     Σ value(rows) + dropped.valueSum  =  reserve + distributable × availableVorp / supply
 *
 * The first makes the deduction legible: the room's gross FAAB, what is expected to
 * leave unspent, and the floor every available player is guaranteed. The second is
 * smaller than the pool on purpose: a dollar is spread over the whole season's supply,
 * and this week's available players are only `availableVorp / supply` of it. The
 * remainder is not missing — it is what the rosters released by future chops are worth.
 *
 * `reserve` is read from the file, never derived: once leakage comes out of the pool,
 * `pool − distributable` is the reserve PLUS the leakage.
 *
 * A version-1 board had no leakage and no recorded reserve, so its reserve IS
 * `pool − distributable`, and it is checked under that identity (tickets/007 AC8).
 */
export function assertEconomyCloses(board: Board | BoardV1, where: string): void {
  const { economy, dropped } = board.diagnostics;
  // No FAAB, no economy and no dollars on any row: nothing to close.
  if (economy === null) return;

  const v2 = "leakage" in economy ? economy : null;
  const reserve = v2 ? v2.reserve : economy.pool - economy.distributable;

  if (v2) {
    const net = v2.pool - v2.leakage - v2.reserve;
    if (Math.abs(net - v2.distributable) > TOLERANCE) {
      throw new BoardEconomyError(
        `the economy in ${where} does not close: a pool of ${v2.pool.toFixed(2)} less ` +
          `${v2.leakage.toFixed(2)} leakage and a ${v2.reserve.toFixed(2)} reserve leaves ` +
          `${net.toFixed(2)}, but the file distributes ${v2.distributable.toFixed(2)}.`,
      );
    }
  }

  const shown = board.rows.reduce((sum, row) => sum + (row.value ?? 0), 0);
  const actual = shown + (dropped.valueSum ?? 0);
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
