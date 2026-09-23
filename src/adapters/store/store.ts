import { mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import {
  BOARD_SCHEMA_VERSION,
  BoardSchema,
  BoardV1Schema,
  assertEconomyCloses,
  serializeBoard,
  type Board,
  type BoardV1,
} from "../../core/board/artifact.ts";
import type { AsOf } from "../../core/ports.ts";
import { PRICED_POSITIONS } from "../../core/types.ts";

/**
 * The data root and the as-of file rules (docs/data-model.md).
 *
 * Two rules do all the work here:
 *   1. A fetch writes a NEW file stamped with the moment it was fetched. Nothing is
 *      ever overwritten, so no TTL is needed and no run can silently change under you.
 *   2. Reading means reading the newest file for that key. Timestamps sort
 *      lexicographically, so "newest" is the last name in the directory listing.
 *
 * Every payload is wrapped in an envelope carrying where it came from and when, which
 * is what lets a board record exactly which files it priced.
 */

export const DEFAULT_DATA_ROOT = "../ff-assistant-data";

/** Bumped when the envelope's own shape changes; a reader that meets an unknown one refuses. */
export const ENVELOPE_SCHEMA_VERSION = 1;

const EnvelopeSchema = z.object({
  schemaVersion: z.literal(ENVELOPE_SCHEMA_VERSION),
  kind: z.string(),
  fetchedAt: z.iso.datetime(),
  source: z.string(),
  data: z.unknown(),
});

const LeagueEntrySchema = z.object({
  key: z
    .string()
    .min(1)
    .regex(/^[a-z0-9-]+$/, "league keys are lowercase slugs"),
  leagueId: z.string().regex(/^\d+$/, "a Sleeper league id is digits"),
  /**
   * Chops per week, for a guillotine room. Sleeper exposes the format but not the
   * cadence, and the cadence sets the survival curve, the capacity guard and the
   * count of chops still to come — so it is stated here by hand rather than assumed
   * to be one, which would price a two-a-week room on a half-speed curve.
   */
  chopsPerWeek: z.number().int().positive().optional(),
  /**
   * Positions nobody bids real money on, priced at the league's floor with their
   * dollars redistributed to the rest. A house judgment about the room, not a Sleeper
   * fact — and a measured one: across 23 completed 2025 guillotine rooms the top
   * weekly bids were RB 32, WR 22, QB 9, TE 6, and no kickers at all.
   */
  floorPositions: z.array(z.enum(PRICED_POSITIONS)).optional(),
});

const LeaguesFileSchema = z.object({
  season: z.string().regex(/^\d{4}$/),
  leagues: z.array(LeagueEntrySchema).min(1),
});

export type LeagueEntry = z.infer<typeof LeagueEntrySchema>;
export type LeaguesFile = z.infer<typeof LeaguesFileSchema>;

/**
 * Timestamps go in filenames, so colons are out: 2026-09-18T20-58-17-123Z.
 * Milliseconds are kept: two fetches of the same kind inside one second are ordinary
 * (the Tuesday run pulls 17 weeks of projections in a few hundred milliseconds), and
 * truncating to seconds would have them overwrite each other — against the one rule
 * this module exists to keep.
 */
export function stampFrom(iso: string): string {
  return iso.replace(/[:.]/g, "-");
}

export class DataRootError extends Error {}

/** A share of a budget: what fraction was left unspent. Outside 0–1 is not a share. */
const Share = z.number().min(0).max(1);

/**
 * The measured unspent curve (tickets/007): what share of a budget leaves with a team
 * chopped in each week, and what the survivor never spends. Measured from 2025 rooms,
 * reviewed by Logan, and read from the data repo — never a literal in the code.
 *
 * `reviewed` is required, and it is the structured one: a curve prices nothing until
 * Logan has accepted it (docs/brief.md), and prose in `provenance.reviewedBy` is not
 * something code can check.
 */
const UnspentCurveSchema = z.object({
  /** Like a board, a curve whose version this build does not know is refused, not guessed at. */
  schemaVersion: z.literal(1),
  measuredAt: z.string().min(1),
  method: z.string().min(1),
  sample: z.object({
    leagues: z.number().int().positive(),
    choppedRosterRowsUsed: z.number().int().positive(),
  }),
  reviewed: z.object({ by: z.string().min(1), on: z.string().min(1) }),
  byChopWeek: z.array(z.object({ week: z.number().int().positive(), mean: Share })).min(1),
  survivorResidual: z.object({ mean: Share }),
});
export type MeasuredUnspentCurve = z.infer<typeof UnspentCurveSchema>;

/** The one curve pricing reads. A new measurement is a new file, reviewed on its own. */
export const UNSPENT_CURVE_FILE = path.join("measured", "chop-unspent-v1.json");

/** Raised when a board already exists and the caller has not said it may be replaced. */
export class BoardLockedError extends Error {}

/** Which league-week a frozen board belongs to. */
export type BoardKey = {
  season: string;
  week: number;
  leagueKey: string;
};

export class Store {
  readonly root: string;

  constructor(root: string = process.env.DATA_ROOT ?? DEFAULT_DATA_ROOT) {
    this.root = path.resolve(root);
    if (!existsSync(this.root)) {
      throw new DataRootError(
        `DATA_ROOT does not exist: ${this.root}\n` +
          `League data lives in a private repo beside this one. Clone it, or set DATA_ROOT.`,
      );
    }
  }

  /** Where a kind's as-of files live: raw/<season>/. */
  private rawDir(season: string): string {
    return path.join(this.root, "raw", season);
  }

  /**
   * Write a payload as a new as-of file. Returns the envelope, whose `file` is the
   * repo-relative path a board records in its diagnostics.
   */
  writeRaw<T>(args: {
    season: string;
    kind: string;
    data: T;
    source: string;
    fetchedAt: string;
  }): AsOf<T> {
    const dir = this.rawDir(args.season);
    mkdirSync(dir, { recursive: true });
    const file = path.join("raw", args.season, `${args.kind}--${stampFrom(args.fetchedAt)}.json`);
    const envelope = {
      schemaVersion: ENVELOPE_SCHEMA_VERSION,
      kind: args.kind,
      fetchedAt: args.fetchedAt,
      source: args.source,
      data: args.data,
    };
    writeFileSync(path.join(this.root, file), JSON.stringify(envelope));
    return { data: args.data, fetchedAt: args.fetchedAt, source: args.source, file };
  }

  /** The newest as-of file for a kind, or null when none has been fetched. */
  readNewestRaw<T>(season: string, kind: string): AsOf<T> | null {
    const dir = this.rawDir(season);
    if (!existsSync(dir)) return null;
    const prefix = `${kind}--`;
    const newest = readdirSync(dir)
      .filter((f) => f.startsWith(prefix) && f.endsWith(".json"))
      .sort()
      .at(-1);
    if (newest === undefined) return null;

    const file = path.join("raw", season, newest);
    const parsed = EnvelopeSchema.safeParse(
      JSON.parse(readFileSync(path.join(this.root, file), "utf8")),
    );
    if (!parsed.success) {
      const found = (
        JSON.parse(readFileSync(path.join(this.root, file), "utf8")) as {
          schemaVersion?: unknown;
        }
      ).schemaVersion;
      const legacy = typeof found === "number" ? String(found) : undefined;
      throw new DataRootError(
        legacy === undefined
          ? `as-of file ${file} was written before envelopes carried a schemaVersion. ` +
              `Sleeper payloads are refetchable — re-run with --refresh.`
          : `as-of file ${file} is envelope version ${legacy}; this build reads ` +
              `version ${ENVELOPE_SCHEMA_VERSION}. Re-run with --refresh.\n${parsed.error.message}`,
      );
    }
    return {
      data: parsed.data.data as T,
      fetchedAt: parsed.data.fetchedAt,
      source: parsed.data.source,
      file,
    };
  }

  /**
   * Where a league-week's frozen board lives: boards/<season>/wk<NN>-<league>.json.
   *
   * One file per league-week, zero-padded so week 3 and week 13 can never collide and
   * so a directory listing sorts into season order. Unlike an as-of file this name
   * carries no timestamp: there is exactly one board per league-week, and replacing it
   * is a decision (see `writeBoard`), not an accident of when the command was run.
   */
  boardPath(key: BoardKey): string {
    const wk = String(key.week).padStart(2, "0");
    return path.join("boards", key.season, `wk${wk}-${key.leagueKey}.json`);
  }

  /** Is this league-week already frozen? Asked without reading the board back. */
  hasBoard(key: BoardKey): boolean {
    return existsSync(path.join(this.root, this.boardPath(key)));
  }

  /**
   * Freeze a board. Validates the whole envelope first, so a board that fails its own
   * schema writes nothing at all.
   *
   * An existing board is NEVER replaced unless the caller passes `overwrite`. The
   * store cannot tell whether this week's claims have cleared — that takes a fetch,
   * and this module makes no network calls — so it refuses by default and leaves the
   * judgment to the one caller that can make it (docs/brief.md, Delivery; the CLI).
   */
  writeBoard(
    board: Board,
    opts: { overwrite?: boolean } = {},
  ): { file: string; overwrote: boolean } {
    const file = this.boardPath({
      season: board.season,
      week: board.week,
      leagueKey: board.leagueKey,
    });
    const absolute = path.join(this.root, file);

    // Before the directory is created, before anything touches the disk.
    const json = serializeBoard(board);

    const overwrote = existsSync(absolute);
    if (overwrote && opts.overwrite !== true) {
      throw new BoardLockedError(
        `${file} is already frozen, and nothing said it may be replaced. ` +
          `A frozen board may be overwritten before that week's claims clear, never after.`,
      );
    }

    mkdirSync(path.dirname(absolute), { recursive: true });
    writeFileSync(absolute, json);
    return { file, overwrote };
  }

  /**
   * Read a frozen board back — for Logan, for a test, for later analysis.
   *
   * NOT for pricing: a board is a record, not an input (docs/data-model.md), and no
   * code path that prices a week may call this.
   */
  readBoard(key: BoardKey): Board | BoardV1 {
    const file = this.boardPath(key);
    const absolute = path.join(this.root, file);
    if (!existsSync(absolute)) {
      throw new DataRootError(`no frozen board at ${file}.`);
    }
    const raw: unknown = JSON.parse(readFileSync(absolute, "utf8"));

    // The version is checked on its own, FIRST. A version this build does not know
    // may hold fields it cannot describe, and reporting a row-shape error about them
    // would send the reader hunting the wrong bug.
    const found = (raw as { schemaVersion?: unknown } | null)?.schemaVersion;
    if (found !== BOARD_SCHEMA_VERSION && found !== 1) {
      throw new DataRootError(
        `${file} is board schema version ${String(found)}; this build reads versions 1 and ` +
          `${BOARD_SCHEMA_VERSION}. Frozen boards are never migrated — past weeks are ` +
          `immutable — so read it with the build that wrote it.`,
      );
    }

    // Version 1 is read as it was written, never upgraded: a record keeps its own shape.
    const parsed = (found === 1 ? BoardV1Schema : BoardSchema).safeParse(raw);
    if (!parsed.success) {
      throw new DataRootError(
        `${file} is not a board this build can read:\n${parsed.error.message}`,
      );
    }
    // Every load, not only the run that wrote it: a board whose dollars no longer add
    // up is a corrupt record, and a silently wrong record is worse than a missing one.
    assertEconomyCloses(parsed.data, file);
    return parsed.data;
  }

  /**
   * The measured unspent curve, or a refusal: missing, unreadable, the wrong shape, or
   * not yet accepted by Logan. Never a default — a guessed curve is an invented number.
   */
  readUnspentCurve(): MeasuredUnspentCurve {
    const absolute = path.join(this.root, UNSPENT_CURVE_FILE);
    if (!existsSync(absolute)) {
      throw new DataRootError(
        `no measured unspent curve at ${UNSPENT_CURVE_FILE}; a guillotine room's pool cannot ` +
          `be priced without it (tickets/007).`,
      );
    }
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(absolute, "utf8"));
    } catch (error) {
      throw new DataRootError(`${UNSPENT_CURVE_FILE} is not readable JSON: ${String(error)}`);
    }
    const parsed = UnspentCurveSchema.safeParse(raw);
    if (!parsed.success) {
      throw new DataRootError(
        `${UNSPENT_CURVE_FILE} is not a curve this build can price from — it needs its ` +
          `sample, date, method and a structured reviewed: { by, on }:\n${parsed.error.message}`,
      );
    }
    return parsed.data;
  }

  /** Which leagues this data root knows about. League ids never live in the code repo. */
  leagues(): LeaguesFile {
    const file = path.join(this.root, "leagues.json");
    if (!existsSync(file)) {
      throw new DataRootError(`no leagues.json in ${this.root} — nothing to price.`);
    }
    const parsed = LeaguesFileSchema.safeParse(JSON.parse(readFileSync(file, "utf8")));
    if (!parsed.success) {
      throw new DataRootError(`leagues.json is malformed:\n${parsed.error.message}`);
    }
    return parsed.data;
  }

  league(key: string): LeagueEntry {
    const { leagues } = this.leagues();
    const found = leagues.find((l) => l.key === key);
    if (!found) {
      throw new DataRootError(
        `unknown league "${key}". Configured: ${leagues.map((l) => l.key).join(", ")}`,
      );
    }
    return found;
  }
}
