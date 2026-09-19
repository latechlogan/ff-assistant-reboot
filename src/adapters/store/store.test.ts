import { mkdtempSync, mkdirSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, test } from "vitest";
import { DataRootError, Store } from "./store.ts";

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
