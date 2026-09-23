/**
 * Interface assumed by 007's tests (tickets/007, written before the implementation):
 *
 *   BOARD_SCHEMA_VERSION is 2. A version-2 board's `diagnostics.economy` adds
 *     leakage: number, reserve: number, releaseEquivalents: number
 *   to version 1's fields; `pool` is the room's gross FAAB.
 *   readBoard(key) accepts version 2 AND version 1:
 *     - v2 is checked by both  distributable = pool − leakage − reserve  and
 *       Σ value(rows) + dropped.valueSum = reserve + distributable × availableVorp / supply,
 *       with `reserve` read from the file (never pool − distributable);
 *     - v1 is checked under v1's identity, reserve = pool − distributable, no leakage;
 *     - any other version is refused with DataRootError, as before (004 AC7).
 *     Either identity failing throws an error whose message matches /econom/i.
 *   Store#readUnspentCurve(): reads measured/chop-unspent-v1.json under the data root
 *     and returns the parsed artifact, at least
 *       { measuredAt: string; method: string;
 *         sample: { leagues: number; choppedRosterRowsUsed: number };
 *         reviewed: { by: string; on: string };
 *         byChopWeek: { week: number; mean: number }[];
 *         survivorResidual: { mean: number } }
 *     and throws DataRootError when the file is missing, is not JSON, does not match
 *     that shape, or has no structured `reviewed: { by, on }` (the prose
 *     `provenance.reviewedBy` does not count).
 */
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, test } from "vitest";
import { BOARD_SCHEMA_VERSION, type Board } from "../../core/board/artifact.ts";
import { BoardLockedError, DataRootError, Store } from "./store.ts";

/** A throwaway data root per test — these are adapter tests, so real files are the point. */
function newRoot(): string {
  return mkdtempSync(path.join(tmpdir(), "ffa-store-"));
}

describe("as-of files", () => {
  let root: string;
  let store: Store;

  beforeEach(() => {
    root = newRoot();
    store = new Store(root);
  });

  test("a write never overwrites an earlier fetch of the same kind", () => {
    const first = store.writeRaw({
      season: "2026",
      kind: "rosters-chopped-wk02",
      data: { v: 1 },
      source: "https://example.test/a",
      fetchedAt: "2026-09-15T13:00:00.000Z",
    });
    const second = store.writeRaw({
      season: "2026",
      kind: "rosters-chopped-wk02",
      data: { v: 2 },
      source: "https://example.test/a",
      fetchedAt: "2026-09-18T13:00:00.000Z",
    });

    expect(first.file).not.toBe(second.file);
    expect(readdirSync(path.join(root, "raw", "2026"))).toHaveLength(2);
  });

  test("reading returns the newest fetch, and says which file it was", () => {
    store.writeRaw({
      season: "2026",
      kind: "nfl-state",
      data: { week: 2 },
      source: "s",
      fetchedAt: "2026-09-15T13:00:00.000Z",
    });
    store.writeRaw({
      season: "2026",
      kind: "nfl-state",
      data: { week: 3 },
      source: "s",
      fetchedAt: "2026-09-22T13:00:00.000Z",
    });

    const newest = store.readNewestRaw<{ week: number }>("2026", "nfl-state");
    expect(newest?.data.week).toBe(3);
    expect(newest?.file).toContain("2026-09-22");
  });

  test("timestamps sort lexicographically across days, months and years", () => {
    for (const iso of [
      "2026-09-09T23:00:00.000Z",
      "2026-09-10T01:00:00.000Z",
      "2026-10-01T01:00:00.000Z",
      "2027-01-01T01:00:00.000Z",
    ]) {
      store.writeRaw({ season: "2026", kind: "k", data: { iso }, source: "s", fetchedAt: iso });
    }
    const newest = store.readNewestRaw<{ iso: string }>("2026", "k");
    expect(newest?.data.iso).toBe("2027-01-01T01:00:00.000Z");
  });

  test("a kind never fetched reads as null rather than throwing", () => {
    expect(store.readNewestRaw("2026", "never-fetched")).toBeNull();
  });

  test("one kind's files are never confused with another's", () => {
    store.writeRaw({
      season: "2026",
      kind: "league-chopped",
      data: { a: 1 },
      source: "s",
      fetchedAt: "2026-09-18T00:00:00.000Z",
    });
    store.writeRaw({
      season: "2026",
      kind: "league-standard",
      data: { b: 2 },
      source: "s",
      fetchedAt: "2026-09-19T00:00:00.000Z",
    });

    expect(store.readNewestRaw<{ a: number }>("2026", "league-chopped")?.data).toEqual({ a: 1 });
  });

  test("a corrupt envelope fails loudly and names the file", () => {
    mkdirSync(path.join(root, "raw", "2026"), { recursive: true });
    writeFileSync(
      path.join(root, "raw", "2026", "broken--2026-09-18T00-00-00Z.json"),
      '{"nope":true}',
    );

    expect(() => store.readNewestRaw("2026", "broken")).toThrow(DataRootError);
  });
});

describe("league registry", () => {
  test("a missing data root explains itself instead of failing deep in a run", () => {
    expect(() => new Store(path.join(tmpdir(), "definitely-not-here-ffa"))).toThrow(DataRootError);
  });

  test("an unknown league key lists the ones that are configured", () => {
    const root = newRoot();
    writeFileSync(
      path.join(root, "leagues.json"),
      JSON.stringify({
        season: "2026",
        leagues: [{ key: "chopped", leagueId: "900000000000000001" }],
      }),
    );

    expect(() => new Store(root).league("nope")).toThrow(/chopped/);
  });

  test("a malformed leagues.json is refused rather than half-read", () => {
    const root = newRoot();
    writeFileSync(path.join(root, "leagues.json"), JSON.stringify({ season: "26", leagues: [] }));

    expect(() => new Store(root).leagues()).toThrow(DataRootError);
  });
});

/**
 * Frozen boards (tickets/004, AC1–AC7).
 *
 * A board is the one artifact this project writes on purpose, so the store's job here
 * is narrow and testable: the path rule, refusing to clobber one, and refusing to read
 * a file this build does not understand.
 */

/**
 * A minimal board whose economy closes, so a test that breaks the identity has to
 * break it deliberately. A $2 floor over 3 available players reserves $6, leaving 94
 * to distribute; a fifth of the season's supply is available this week, so the one
 * priced row is worth 2 + 94 × 20 / 100 = $20.80 and the two dropped rows $2 each.
 */
function sampleBoard(overrides: Partial<Board> = {}): Board {
  return {
    schemaVersion: BOARD_SCHEMA_VERSION,
    leagueKey: "chopped",
    season: "2026",
    week: 3,
    generatedAt: "2026-09-22T15:00:00.000Z",
    inputs: ["raw/2026/nfl-state--2026-09-22T14-44-54-304Z.json"],
    diagnostics: {
      week: 3,
      throughWeek: 15,
      liveTeams: 14,
      choppedTeams: 2,
      availablePool: 3,
      replacement: { QB: 10, RB: 9, WR: 8, TE: 7, K: 6 },
      survivalWeights: [1, 0.9],
      floorPositions: ["K"],
      // A $2 floor over 3 available players reserves $6, so `reserve` is a real term
      // in the identity: 20.8 (row) + 4 (two dropped rows at the floor) = 6 + 94 × 20/100.
      // With a $0 floor, deleting `reserve +` from the check would pass unnoticed.
      economy: {
        pool: 100,
        // Version 2 (tickets/007): nothing leaks here — a non-guillotine economy — so
        // the reserve and the deduction are the only terms, and both are recorded.
        leakage: 0,
        reserve: 6,
        distributable: 94,
        availableVorp: 20,
        rosteredVorpPerTeam: 40,
        chopsRemaining: 2,
        releaseEquivalents: 2,
        supply: 100,
        dollarsPerVorp: 0.94,
      },
      dropped: { rowCount: 2, valueSum: 4 },
    },
    rows: [
      {
        playerId: "4034",
        name: "Player One",
        team: "KC",
        position: "RB",
        points: 100,
        vorp: 20,
        value: 20.8,
      },
    ],
    ...overrides,
  };
}

describe("frozen boards", () => {
  let root: string;
  let store: Store;

  beforeEach(() => {
    root = newRoot();
    store = new Store(root);
  });

  test("004 AC1 — a board freezes at boards/<season>/wk<NN>-<league>.json and says where", () => {
    const written = store.writeBoard(sampleBoard());

    expect(written.file).toBe(path.join("boards", "2026", "wk03-chopped.json"));
    expect(written.overwrote).toBe(false);
    expect(existsSync(path.join(root, written.file))).toBe(true);
  });

  test("004 AC1 — the week is zero-padded, so week 3 and week 13 never share a name", () => {
    const three = store.writeBoard(sampleBoard());
    const thirteen = store.writeBoard(sampleBoard({ week: 13 }));

    expect(three.file).toContain("wk03-");
    expect(thirteen.file).toContain("wk13-");
  });

  test("004 AC2 — an envelope that fails the outbound schema writes nothing at all", () => {
    const broken = sampleBoard({
      // A row with no name: the file exists to be read by a human, and an id is not
      // a player. This has to be caught before anything reaches the disk.
      rows: [{ playerId: "4034", position: "RB", points: 1, vorp: 1, value: 1 } as never],
    });

    expect(() => store.writeBoard(broken)).toThrow();
    expect(existsSync(path.join(root, "boards", "2026", "wk03-chopped.json"))).toBe(false);
  });

  test("004 AC2 — every field of the envelope survives the round trip", () => {
    const board = sampleBoard();
    store.writeBoard(board);

    expect(store.readBoard({ season: "2026", week: 3, leagueKey: "chopped" })).toEqual(board);
  });

  test("004 AC6 — an existing board is never overwritten unless the caller says it may", () => {
    store.writeBoard(sampleBoard());
    const later = sampleBoard({ generatedAt: "2026-09-22T16:00:00.000Z" });

    // The caller is the one that knows whether this week's claims have cleared. The
    // store's job is to make an overwrite impossible to do by accident.
    expect(() => store.writeBoard(later)).toThrow(BoardLockedError);

    const again = store.writeBoard(later, { overwrite: true });
    expect(again.overwrote).toBe(true);
    expect(store.readBoard({ season: "2026", week: 3, leagueKey: "chopped" }).generatedAt).toBe(
      "2026-09-22T16:00:00.000Z",
    );
  });

  test("004 AC7 — a board from an unknown schema version is refused, naming the file and both versions", () => {
    const file = path.join("boards", "2026", "wk03-chopped.json");
    mkdirSync(path.join(root, "boards", "2026"), { recursive: true });
    writeFileSync(
      path.join(root, file),
      JSON.stringify({ ...sampleBoard(), schemaVersion: BOARD_SCHEMA_VERSION + 1 }),
    );

    let thrown: unknown;
    try {
      store.readBoard({ season: "2026", week: 3, leagueKey: "chopped" });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(DataRootError);
    const message = (thrown as Error).message;
    expect(message).toContain(file);
    expect(message).toContain(String(BOARD_SCHEMA_VERSION + 1));
    expect(message).toContain(String(BOARD_SCHEMA_VERSION));
  });

  test("004 AC7 — the version is checked before the rest of the file is parsed", () => {
    // A version-2 file might hold rows this build cannot even describe. Meeting one
    // and reporting a row-shape error would send the reader hunting the wrong bug.
    mkdirSync(path.join(root, "boards", "2026"), { recursive: true });
    writeFileSync(
      path.join(root, "boards", "2026", "wk03-chopped.json"),
      JSON.stringify({ schemaVersion: BOARD_SCHEMA_VERSION + 1, rows: "not even an array" }),
    );

    expect(() => store.readBoard({ season: "2026", week: 3, leagueKey: "chopped" })).toThrow(
      new RegExp(`version ${BOARD_SCHEMA_VERSION + 1}`),
    );
  });

  test("004 AC4 — every load checks that the economy closes, and refuses a board that does not", () => {
    const file = path.join("boards", "2026", "wk03-chopped.json");
    mkdirSync(path.join(root, "boards", "2026"), { recursive: true });
    const board = sampleBoard();
    // One dollar quietly taken off the only row. Nothing else in the file changes,
    // so only the identity can catch it.
    writeFileSync(
      path.join(root, file),
      JSON.stringify({
        ...board,
        rows: [{ ...(board.rows[0] as Board["rows"][number]), value: 19.8 }],
      }),
    );

    expect(() => store.readBoard({ season: "2026", week: 3, leagueKey: "chopped" })).toThrow(
      /econom/i,
    );
  });

  test("004 AC4 — the floor's reserve is part of what closes, so a room with a floor loads", () => {
    // sampleBoard reserves $6; without the reserve term the identity is off by exactly that.
    store.writeBoard(sampleBoard());

    expect(() => store.readBoard({ season: "2026", week: 3, leagueKey: "chopped" })).not.toThrow();
  });

  test("004 AC4 — a league with no FAAB has no economy to close, and loads anyway", () => {
    const board = sampleBoard({
      diagnostics: {
        ...sampleBoard().diagnostics,
        economy: null,
        dropped: { rowCount: 2, valueSum: null },
      },
      rows: [
        {
          playerId: "4034",
          name: "Player One",
          team: "KC",
          position: "RB",
          points: 100,
          vorp: 20,
          value: null,
        },
      ],
    });
    store.writeBoard(board);

    expect(store.readBoard({ season: "2026", week: 3, leagueKey: "chopped" })).toEqual(board);
  });

  test("004 AC6 — asking whether a week is already frozen never reads the board back", () => {
    expect(store.hasBoard({ season: "2026", week: 3, leagueKey: "chopped" })).toBe(false);
    store.writeBoard(sampleBoard());
    expect(store.hasBoard({ season: "2026", week: 3, leagueKey: "chopped" })).toBe(true);
  });
});

/**
 * Ticket 007 — the leakage curve, read through the store, and the version-2 board.
 */

/**
 * A trimmed copy of measured/chop-unspent-v1.json (../ff-assistant-data): the fields a
 * reader needs, with `reviewed` added as AC3 requires. League ids and names are left
 * out on purpose — they are private and nothing here needs them.
 */
function unspentArtifact(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    id: "chop-unspent-v1",
    measuredAt: "2026-09-22",
    sample: { leagues: 23, choppedRosterRowsUsed: 377, survivorRows: 24 },
    method:
      "unspent = budget - waiver_budget_used; unspent_frac = unspent / budget; mean by chop week.",
    byChopWeek: [
      { week: 1, n: 21, mean: 0.9998, median: 1.0 },
      { week: 2, n: 23, mean: 0.9578, median: 1.0 },
      { week: 3, n: 23, mean: 0.7777, median: 0.97 },
      { week: 4, n: 23, mean: 0.7453, median: 0.8 },
      { week: 5, n: 23, mean: 0.721, median: 0.88 },
      { week: 6, n: 23, mean: 0.673, median: 0.82 },
      { week: 7, n: 23, mean: 0.471, median: 0.413 },
      { week: 8, n: 22, mean: 0.2253, median: 0.1435 },
      { week: 9, n: 22, mean: 0.2265, median: 0.1915 },
      { week: 10, n: 23, mean: 0.1703, median: 0.115 },
      { week: 11, n: 24, mean: 0.1316, median: 0.062 },
      { week: 12, n: 23, mean: 0.0442, median: 0.015 },
      { week: 13, n: 23, mean: 0.1025, median: 0.03 },
      { week: 14, n: 23, mean: 0.0252, median: 0.0 },
      { week: 15, n: 23, mean: 0.0228, median: 0.0 },
      { week: 16, n: 19, mean: 0.02, median: 0.0 },
      { week: 17, n: 16, mean: 0.0075, median: 0.0 },
    ],
    survivorResidual: { n: 24, mean: 0.0182, median: 0.0055, max: 0.155 },
    provenance: { reviewedBy: "A. Reviewer, 2026-09-22. Accepted as the prior." },
    reviewed: { by: "A. Reviewer", on: "2026-09-22" },
    ...overrides,
  };
}

function writeUnspent(root: string, content: string): void {
  mkdirSync(path.join(root, "measured"), { recursive: true });
  writeFileSync(path.join(root, "measured", "chop-unspent-v1.json"), content);
}

describe("007 — the measured leakage curve", () => {
  let root: string;
  let store: Store;

  beforeEach(() => {
    root = newRoot();
    store = new Store(root);
  });

  test("007 AC3 — the curve is read from measured/, carrying its sample, date, method and acceptance", () => {
    writeUnspent(root, JSON.stringify(unspentArtifact()));

    const curve = store.readUnspentCurve();

    expect(curve.sample.leagues).toBe(23);
    expect(curve.sample.choppedRosterRowsUsed).toBe(377);
    expect(curve.measuredAt).toBe("2026-09-22");
    expect(curve.method.length).toBeGreaterThan(0);
    expect(curve.reviewed).toEqual({ by: "A. Reviewer", on: "2026-09-22" });
    expect(curve.byChopWeek.find((entry) => entry.week === 7)?.mean).toBe(0.471);
    expect(curve.survivorResidual.mean).toBe(0.0182);
  });

  test("007 AC3 — a missing curve is refused, never replaced by a default", () => {
    expect(() => store.readUnspentCurve()).toThrow(DataRootError);
  });

  test("007 AC3 — an unreadable curve is refused as a data-root error, not a stray parse error", () => {
    writeUnspent(root, "{ this is not json");

    expect(() => store.readUnspentCurve()).toThrow(DataRootError);
  });

  test("007 AC3 — a curve of the wrong shape is refused", () => {
    writeUnspent(root, JSON.stringify(unspentArtifact({ byChopWeek: "weeks 1-17" })));

    expect(() => store.readUnspentCurve()).toThrow(DataRootError);
  });

  test("007 AC3 — a curve with only the prose reviewedBy, and no structured acceptance, is refused", () => {
    const { reviewed: _reviewed, ...unreviewed } = unspentArtifact();
    writeUnspent(root, JSON.stringify(unreviewed));

    expect(() => store.readUnspentCurve()).toThrow(DataRootError);
    expect(() => store.readUnspentCurve()).toThrow(/review/i);
  });

  test("007 AC3 — an acceptance missing who or when is no acceptance", () => {
    writeUnspent(root, JSON.stringify(unspentArtifact({ reviewed: { by: "A. Reviewer" } })));
    expect(() => store.readUnspentCurve()).toThrow(DataRootError);

    writeUnspent(root, JSON.stringify(unspentArtifact({ reviewed: { on: "2026-09-22" } })));
    expect(() => store.readUnspentCurve()).toThrow(DataRootError);
  });
});

/**
 * A version-2 board whose economy closes with leakage and a floor both in play, so that
 * `reserve` (6) and `pool − distributable` (36) differ — a reader that derived the
 * reserve would get the identity wrong by $30.
 *
 *   pool 100 − leakage 30 − reserve 6 (a $2 floor × 3 available) = distributable 64
 *   one row:     2 + 64 × 20 / 100 = 14.80
 *   two dropped: 2 × $2            =  4.00
 *   Σ = 18.80 = reserve 6 + 64 × 20 / 100 (12.80)
 */
function sampleBoardV2(economy: Record<string, number> = {}, rowValue = 14.8): Board {
  const board = sampleBoard();
  return {
    ...board,
    schemaVersion: 2,
    diagnostics: {
      ...board.diagnostics,
      economy: {
        pool: 100,
        leakage: 30,
        reserve: 6,
        distributable: 64,
        availableVorp: 20,
        rosteredVorpPerTeam: 40,
        chopsRemaining: 2,
        releaseEquivalents: 1.5,
        supply: 100,
        dollarsPerVorp: 0.64,
        ...economy,
      },
      dropped: { rowCount: 2, valueSum: 4 },
    },
    rows: [{ ...(board.rows[0] as Board["rows"][number]), value: rowValue }],
  } as unknown as Board;
}

/** Write a board file directly, bypassing writeBoard's outbound gate. */
function plant(root: string, board: unknown): void {
  mkdirSync(path.join(root, "boards", "2026"), { recursive: true });
  writeFileSync(path.join(root, "boards", "2026", "wk03-chopped.json"), JSON.stringify(board));
}

const WK03 = { season: "2026", week: 3, leagueKey: "chopped" };

describe("007 — the version-2 board's economy", () => {
  let root: string;
  let store: Store;

  beforeEach(() => {
    root = newRoot();
    store = new Store(root);
  });

  test("007 AC4 — pool, leakage, reserve and distributable are all recorded, and a board that closes loads", () => {
    const board = sampleBoardV2();
    store.writeBoard(board);

    const read = store.readBoard(WK03);
    expect(read.diagnostics.economy).toMatchObject({
      pool: 100,
      leakage: 30,
      reserve: 6,
      distributable: 64,
    });
    expect(read).toEqual(board);
  });

  test("007 AC4 — a distributable that is not pool − leakage − reserve is refused on load", () => {
    // Leakage off by a dollar; every row still closes on the second identity.
    plant(root, sampleBoardV2({ leakage: 31 }));

    expect(() => store.readBoard(WK03)).toThrow(/econom/i);
  });

  test("007 AC4 — the reserve is read from the file: one that disagrees with the rows is refused", () => {
    // Reserve 7 and distributable 63 still satisfy 100 − 30 − 7 = 63, but the rows were
    // priced on a reserve of 6: 7 + 63 × 0.2 = 19.60, not 18.80.
    plant(root, sampleBoardV2({ reserve: 7, distributable: 63 }));

    expect(() => store.readBoard(WK03)).toThrow(/econom/i);
  });

  test("007 AC4 — rows that do not add up are refused on every load", () => {
    plant(root, sampleBoardV2({}, 13.8));

    expect(() => store.readBoard(WK03)).toThrow(/econom/i);
  });
});

describe("007 — boards frozen before 007", () => {
  let root: string;
  let store: Store;

  beforeEach(() => {
    root = newRoot();
    store = new Store(root);
  });

  /**
   * A version-1 board as 004 wrote it (and as boards/2026/wk03-chopped.json is): no
   * leakage, no reserve field, and a $2 floor whose reserve is pool − distributable = 6.
   */
  const v1Board = (rowValue = 20.8): unknown => {
    const board = sampleBoard();
    return {
      ...board,
      schemaVersion: 1,
      diagnostics: {
        ...board.diagnostics,
        /**
         * A version-1 economy exactly as boards were frozen before 007: no leakage, no
         * recorded reserve, no releaseEquivalents. Pinned literally, not derived from
         * sampleBoard — which moved to version 2 — so that reading version 1 with the
         * version-2 schema fails here, as it would on the real frozen week-3 board.
         */
        economy: {
          pool: 100,
          distributable: 94,
          availableVorp: 20,
          rosteredVorpPerTeam: 40,
          chopsRemaining: 2,
          supply: 100,
          dollarsPerVorp: 0.94,
        },
      },
      rows: [{ ...(board.rows[0] as Board["rows"][number]), value: rowValue }],
    };
  };

  test("007 AC8 — the envelope change bumps the board's schema version", () => {
    expect(BOARD_SCHEMA_VERSION).toBe(2);
  });

  test("007 AC8 — a version-1 board still loads, checked under version 1's own identity", () => {
    expect(BOARD_SCHEMA_VERSION).not.toBe(1); // or this proves nothing about old boards
    plant(root, v1Board());

    const read = store.readBoard(WK03) as unknown as { schemaVersion: number; rows: unknown[] };
    expect(read.schemaVersion).toBe(1);
    expect(read.rows).toEqual((v1Board() as { rows: unknown[] }).rows);
  });

  test("007 AC8 — a version-1 board whose economy does not close is still refused", () => {
    expect(BOARD_SCHEMA_VERSION).not.toBe(1);
    // A dollar off the only row; under v1's identity 19.8 + 4 ≠ 6 + 94 × 20 / 100.
    plant(root, v1Board(19.8));

    expect(() => store.readBoard(WK03)).toThrow(/econom/i);
  });

  test("007 AC8 — any version other than 1 or the current one is still refused", () => {
    expect(BOARD_SCHEMA_VERSION).toBe(2);
    for (const version of [0, 3]) {
      plant(root, { ...(v1Board() as object), schemaVersion: version });
      expect(() => store.readBoard(WK03)).toThrow(DataRootError);
    }
  });
});
