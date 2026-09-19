import { mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
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
