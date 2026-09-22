import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, test } from "vitest";
import { BOARD_SCHEMA_VERSION, type Board } from "../../core/board/artifact.ts";
import type { Transaction } from "../sleeper/schemas.ts";
import type { FetchPolicy } from "../sleeper/sleeper.ts";
import { Store } from "../store/store.ts";
import { freeze } from "./freeze.ts";

/**
 * The freeze decision (tickets/004, AC1 and AC6), against a real store on a temp dir
 * and a stub transactions feed. `claimsHaveCleared` has its own tests; these prove the
 * wiring around it — that a cleared week really writes nothing.
 */

/** A no-FAAB board keeps the fixture small: there is no economy to close. */
function board(overrides: Partial<Board> = {}): Board {
  return {
    schemaVersion: BOARD_SCHEMA_VERSION,
    leagueKey: "chopped",
    season: "2026",
    week: 4,
    generatedAt: "2026-09-29T15:00:00.000Z",
    inputs: ["raw/2026/nfl-state--2026-09-29T14-00-00-000Z.json"],
    diagnostics: {
      week: 4,
      throughWeek: 15,
      liveTeams: 12,
      choppedTeams: 4,
      availablePool: 1,
      replacement: { QB: 10, RB: 9, WR: 8, TE: 7, K: 6 },
      survivalWeights: [1, 0.9],
      floorPositions: ["K"],
      economy: null,
      dropped: { rowCount: 0, valueSum: null },
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
    ...overrides,
  };
}

/** Stands in for Sleeper: returns the given week's transactions and records each call's policy. */
function stubSource(transactions: Transaction[]) {
  const source = {
    calls: 0,
    policies: [] as (FetchPolicy | undefined)[],
    transactions: (
      _season: string,
      _leagueKey: string,
      _leagueId: string,
      _week: number,
      policy?: FetchPolicy,
    ) => {
      source.calls++;
      source.policies.push(policy);
      return Promise.resolve({
        data: transactions,
        fetchedAt: "2026-09-29T15:00:00.000Z",
        source: "stub",
        file: "raw/2026/transactions-chopped-wk04--stub.json",
      });
    },
  };
  return source;
}

const PENDING: Transaction[] = [{ type: "waiver", status: "pending" }];
const CLEARED: Transaction[] = [{ type: "waiver", status: "complete" }];

describe("freezing a board", () => {
  let root: string;
  let store: Store;
  const file = path.join("boards", "2026", "wk04-chopped.json");

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "ffa-freeze-"));
    store = new Store(root);
  });

  test("004 AC1 — the current week, claims pending, nothing frozen yet: FROZE", async () => {
    const outcome = await freeze({
      artifact: board(),
      currentWeek: 4,
      leagueId: "stub-league",
      store,
      source: stubSource(PENDING),
    });

    expect(outcome).toEqual({ kind: "froze", file });
    expect(store.hasBoard({ season: "2026", week: 4, leagueKey: "chopped" })).toBe(true);
  });

  test("004 AC6 — claims still pending: an existing board is replaced, and says OVERWROTE", async () => {
    store.writeBoard(board());
    const newer = board({ generatedAt: "2026-09-29T16:00:00.000Z" });

    const outcome = await freeze({
      artifact: newer,
      currentWeek: 4,
      leagueId: "stub-league",
      store,
      source: stubSource(PENDING),
    });

    expect(outcome).toEqual({ kind: "overwrote", file });
    expect(readFileSync(path.join(root, file), "utf8")).toContain("2026-09-29T16:00:00.000Z");
  });

  test("004 AC6 — claims cleared: an existing board is refused, and left byte-for-byte alone", async () => {
    store.writeBoard(board());
    const before = readFileSync(path.join(root, file), "utf8");

    const outcome = await freeze({
      artifact: board({ generatedAt: "2026-09-29T16:00:00.000Z" }),
      currentWeek: 4,
      leagueId: "stub-league",
      store,
      source: stubSource(CLEARED),
    });

    expect(outcome).toMatchObject({ kind: "cleared", file, existing: true });
    expect(readFileSync(path.join(root, file), "utf8")).toBe(before);
  });

  test("004 AC6 — claims cleared before the first run: nothing is frozen, so no post-claims record exists to lock", async () => {
    const outcome = await freeze({
      artifact: board(),
      currentWeek: 4,
      leagueId: "stub-league",
      store,
      source: stubSource(CLEARED),
    });

    expect(outcome).toMatchObject({ kind: "cleared", file, existing: false });
    expect(store.hasBoard({ season: "2026", week: 4, leagueKey: "chopped" })).toBe(false);
  });

  test("004 AC6 — the claims question is always asked fresh, never answered from a cached file", async () => {
    // A copy pulled before the waiver run says "not cleared" for the rest of the week,
    // which is the one answer that lets a record be destroyed.
    const source = stubSource(PENDING);

    await freeze({ artifact: board(), currentWeek: 4, leagueId: "stub-league", store, source });

    expect(source.policies).toEqual([{ refresh: true, requireFresh: true }]);
  });

  test("004 AC6 — a past week is never frozen, and Sleeper is never asked", async () => {
    const source = stubSource(PENDING);

    const outcome = await freeze({
      artifact: board(),
      currentWeek: 5,
      leagueId: "stub-league",
      store,
      source,
    });

    expect(outcome).toEqual({ kind: "past-week", week: 4, currentWeek: 5 });
    expect(source.calls).toBe(0);
    expect(store.hasBoard({ season: "2026", week: 4, leagueKey: "chopped" })).toBe(false);
  });
});
