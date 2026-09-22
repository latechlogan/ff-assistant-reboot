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
        distributable: 94,
        availableVorp: 20,
        rosteredVorpPerTeam: 40,
        chopsRemaining: 2,
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

  test("AC1 — a board freezes at boards/<season>/wk<NN>-<league>.json and says where", () => {
    const written = store.writeBoard(sampleBoard());

    expect(written.file).toBe(path.join("boards", "2026", "wk03-chopped.json"));
    expect(written.overwrote).toBe(false);
    expect(existsSync(path.join(root, written.file))).toBe(true);
  });

  test("AC1 — the week is zero-padded, so week 3 and week 13 never share a name", () => {
    const three = store.writeBoard(sampleBoard());
    const thirteen = store.writeBoard(sampleBoard({ week: 13 }));

    expect(three.file).toContain("wk03-");
    expect(thirteen.file).toContain("wk13-");
  });

  test("AC2 — an envelope that fails the outbound schema writes nothing at all", () => {
    const broken = sampleBoard({
      // A row with no name: the file exists to be read by a human, and an id is not
      // a player. This has to be caught before anything reaches the disk.
      rows: [{ playerId: "4034", position: "RB", points: 1, vorp: 1, value: 1 } as never],
    });

    expect(() => store.writeBoard(broken)).toThrow();
    expect(existsSync(path.join(root, "boards", "2026", "wk03-chopped.json"))).toBe(false);
  });

  test("AC2 — every field of the envelope survives the round trip", () => {
    const board = sampleBoard();
    store.writeBoard(board);

    expect(store.readBoard({ season: "2026", week: 3, leagueKey: "chopped" })).toEqual(board);
  });

  test("AC6 — an existing board is never overwritten unless the caller says it may", () => {
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

  test("AC7 — a board from an unknown schema version is refused, naming the file and both versions", () => {
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

  test("AC7 — the version is checked before the rest of the file is parsed", () => {
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

  test("AC4 — every load checks that the economy closes, and refuses a board that does not", () => {
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

  test("AC4 — the floor's reserve is part of what closes, so a room with a floor loads", () => {
    // sampleBoard reserves $6; without the reserve term the identity is off by exactly that.
    store.writeBoard(sampleBoard());

    expect(() => store.readBoard({ season: "2026", week: 3, leagueKey: "chopped" })).not.toThrow();
  });

  test("AC4 — a league with no FAAB has no economy to close, and loads anyway", () => {
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

  test("AC6 — asking whether a week is already frozen never reads the board back", () => {
    expect(store.hasBoard({ season: "2026", week: 3, leagueKey: "chopped" })).toBe(false);
    store.writeBoard(sampleBoard());
    expect(store.hasBoard({ season: "2026", week: 3, leagueKey: "chopped" })).toBe(true);
  });
});
