import { describe, expect, test } from "vitest";
import { playersFixture, projectionsFixture } from "../../../test/load-fixtures.ts";
import { buildPlayerIndex, type PlayerPayload } from "./index-players.ts";

/**
 * The index is the universe everything downstream is defined against: the available
 * pool is its complement with live rosters (AC6), and an unmatched projection row is
 * one whose player id is not in it (AC10).
 *
 * The 2026 learning it exists to prevent is logged 2026-09-15 — admitting on
 * `position` instead of `fantasy_positions` hid 76 real ids from the boards.
 */

function payload(over: Partial<PlayerPayload> & { player_id: string }): PlayerPayload {
  return { team: null, ...over };
}

describe("who gets into the index", () => {
  test("REG 2026-09-15 — admission is by fantasy_positions, not position", () => {
    const players = playersFixture();

    const { index } = buildPlayerIndex(players);

    // Patrick Ricard is `position: "FB"` — not a priced slot — but `fantasy_positions:
    // ["RB"]`. Keying on `position` drops him; keying on eligibility indexes him at RB.
    expect(players["4353"]?.position).toBe("FB");
    expect(index.get("4353")).toEqual({
      playerId: "4353",
      name: "Patrick Ricard",
      position: "RB",
      team: players["4353"]?.team ?? null,
    });
    // Every player in this fixture is eligible somewhere priced, so none may be lost.
    expect(index.size).toBe(Object.keys(players).length);
  });

  test("REG 2026-09-15 — a punter eligible at K is indexed at K; a player eligible at no priced slot is not indexed", () => {
    const { index } = buildPlayerIndex({
      p1: payload({ player_id: "p1", position: "P", fantasy_positions: ["K", "P"] }),
      d1: payload({ player_id: "d1", position: "LB", fantasy_positions: ["LB"] }),
      d2: payload({ player_id: "d2", position: "DEF", fantasy_positions: ["DEF"] }),
      d3: payload({ player_id: "d3", position: null, fantasy_positions: null }),
    });

    expect(index.get("p1")?.position).toBe("K");
    expect(index.has("d1")).toBe(false);
    expect(index.has("d2")).toBe(false);
    expect(index.has("d3")).toBe(false);
    expect(index.size).toBe(1);
  });

  test("REG 2026-09-15 — a player whose own position is a priced slot keeps it", () => {
    const { index } = buildPlayerIndex({
      // A TE listed as WR-eligible first: his own position wins, so he is priced as a TE.
      te: payload({ player_id: "te", position: "TE", fantasy_positions: ["WR", "TE"] }),
      // Nobody's own position to fall back on: the first priced eligibility decides.
      hyb: payload({ player_id: "hyb", position: "DB", fantasy_positions: ["WR", "RB"] }),
    });

    expect(index.get("te")?.position).toBe("TE");
    expect(index.get("hyb")?.position).toBe("WR");
  });

  test("AC6 — each indexed player carries the identity the pool and the board need", () => {
    const { index } = buildPlayerIndex({
      a: payload({ player_id: "a", full_name: "Ja'Marr Chase", position: "WR", team: "CIN" }),
      b: payload({ player_id: "b", first_name: " Puka ", last_name: " Nacua ", position: "WR" }),
    });

    expect(index.get("a")).toEqual({
      playerId: "a",
      name: "Ja'Marr Chase",
      position: "WR",
      team: "CIN",
    });
    // No full_name: first + last, trimmed. A free agent with no team keeps null, not "".
    expect(index.get("b")).toEqual({
      playerId: "b",
      name: "Puka Nacua",
      position: "WR",
      team: null,
    });
  });

  test("AC1 — a player Sleeper marks inactive is not indexed; an active or flagless one is", () => {
    const { index } = buildPlayerIndex({
      retired: payload({ player_id: "retired", position: "WR", active: false }),
      playing: payload({ player_id: "playing", position: "WR", active: true }),
      // Sleeper sends `active` on every player today, but a field we rely on going
      // missing must not silently empty the board. Absence means active.
      flagless: payload({ player_id: "flagless", position: "WR" }),
      // Null is absence, not false. `if (!player.active)` would read it as inactive and
      // drop a real player; the schema allows null, so the distinction is pinned here.
      nulled: payload({ player_id: "nulled", position: "WR", active: null }),
      // Ticket 009's explicit non-goal: no team is not inactive. A free agent between
      // clubs is exactly the player a waiver board exists to price.
      freeAgent: payload({ player_id: "freeAgent", position: "RB", team: null, active: true }),
    });

    expect(index.has("retired")).toBe(false);
    expect(index.has("playing")).toBe(true);
    expect(index.has("flagless")).toBe(true);
    expect(index.has("nulled")).toBe(true);
    expect(index.has("freeAgent")).toBe(true);
    expect(index.size).toBe(4);
  });
});

describe("what the index makes countable", () => {
  test("AC2 — the index reports how many players it skipped for being inactive, and who", () => {
    const { index, inactive } = buildPlayerIndex({
      r1: payload({
        player_id: "r1",
        full_name: "Retired Receiver",
        position: "WR",
        active: false,
      }),
      r2: payload({
        player_id: "r2",
        first_name: "Cut",
        last_name: "Kicker",
        position: "K",
        active: false,
      }),
      ok: payload({ player_id: "ok", full_name: "Still Playing", position: "RB", active: true }),
      // Never eligible for a priced slot, so he was not skipped FOR BEING INACTIVE —
      // he was never a candidate. Counting him would inflate the number past the
      // 1,081 the week-3 parity gap is made of and make it mean nothing.
      lb: payload({ player_id: "lb", position: "LB", fantasy_positions: ["LB"], active: false }),
    });

    expect(index.size).toBe(1);
    expect(inactive.size).toBe(2);
    expect([...inactive.keys()].sort()).toEqual(["r1", "r2"]);
    // Named, not just counted: AC3 has to be able to say who turned up with points.
    expect(inactive.get("r1")).toBe("Retired Receiver");
    expect(inactive.get("r2")).toBe("Cut Kicker");
    expect(inactive.has("lb")).toBe(false);
  });

  test("AC2 — an all-active payload skips nobody, so a non-zero count is signal", () => {
    const { index, inactive } = buildPlayerIndex(playersFixture());

    expect(inactive.size).toBe(0);
    expect(index.size).toBe(Object.keys(playersFixture()).length);
  });

  test("AC10 — a projection row whose player is not indexed is observably unmatched", () => {
    const rows = [
      ...projectionsFixture(),
      { player_id: "900000000000000099", week: 2, season: "2026", stats: { gp: 1 } },
    ];

    const { index } = buildPlayerIndex(playersFixture());
    const unmatched = rows.filter((row) => !index.has(row.player_id));

    // Every real fixture row matches, so a non-zero count is signal rather than noise:
    // the one row that does not match is the one that is not a player we know.
    expect(unmatched.map((row) => row.player_id)).toEqual(["900000000000000099"]);
  });
});
