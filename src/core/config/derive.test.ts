import { describe, expect, test } from "vitest";
import { leagueFixture } from "../../../test/load-fixtures.ts";
import { UnsupportedLeagueError } from "../types.ts";
import { deriveLeagueConfig, type LeaguePayload } from "./derive.ts";

/**
 * AC2 — league settings come from the league's own Sleeper payload, and a format we
 * do not model is refused by name rather than approximated (tickets/001).
 *
 * The fixture league is the chopped room: 16 teams, `roster_positions` of
 * QB/RB/RB/WR/WR/TE/FLEX/FLEX/K + 6×BN, `settings.type` 3 (guillotine),
 * `waiver_type` 2 (FAAB), `waiver_budget` 1000, `waiver_bid_min` 0.
 */

/** The refusal a payload produces, or a loud failure if it was quietly accepted. */
function refusalFrom(payload: LeaguePayload): UnsupportedLeagueError {
  try {
    deriveLeagueConfig(payload);
  } catch (error) {
    if (error instanceof UnsupportedLeagueError) return error;
    throw error;
  }
  throw new Error("expected an UnsupportedLeagueError, but the league was accepted");
}

describe("deriving a league from its own settings", () => {
  test("AC2 — reads teams, roster shape, scoring and FAAB from the payload", () => {
    const payload = leagueFixture();

    const config = deriveLeagueConfig(payload);

    expect(config.leagueId).toBe(payload.league_id);
    expect(config.season).toBe(payload.season);
    expect(config.teams).toBe(payload.total_rosters); // 16, from the payload, not a constant
    expect(config.rosterPositions).toEqual(payload.roster_positions);
    // QB·1 RB·2 WR·2 TE·1 K·1 dedicated; FLEX·2; BN·6; 9 + 6 = 15 auction slots.
    expect(config.starters).toEqual({ QB: 1, RB: 2, WR: 2, TE: 1, K: 1 });
    expect(config.flexSlots).toBe(2);
    expect(config.benchSlots).toBe(6);
    expect(config.rosterSize).toBe(15);
    expect(config.format).toBe("guillotine"); // settings.type === 3
    expect(config.waiver).toEqual({ kind: "faab", budget: 1000, minBid: 0 });
    // Scoring passes through whole: the league scores 6-point passing TDs, not the public 4.
    expect(config.scoring["pass_td"]).toBe(6);
    expect(config.scoring["rec"]).toBe(1);
  });

  test("AC2 — every number tracks the payload, so a different room derives different numbers", () => {
    const payload = leagueFixture();
    payload.total_rosters = 8;
    payload.roster_positions = ["QB", "RB", "WR", "FLEX", "BN", "BN"];
    payload.settings.waiver_budget = 250;
    payload.settings.waiver_bid_min = 2;

    const config = deriveLeagueConfig(payload);

    // Nothing here may come from the 16-team, $1,000 room the fixture describes.
    expect(config.teams).toBe(8);
    expect(config.starters).toEqual({ QB: 1, RB: 1, WR: 1, TE: 0, K: 0 });
    expect(config.flexSlots).toBe(1);
    expect(config.benchSlots).toBe(2);
    expect(config.rosterSize).toBe(6); // 4 starting slots + 2 bench
    expect(config.waiver).toEqual({ kind: "faab", budget: 250, minBid: 2 });
  });

  test("AC2 — IR and taxi slots are not auction slots and do not count toward roster size", () => {
    const payload = leagueFixture();
    payload.roster_positions = ["QB", "RB", "WR", "FLEX", "BN", "BN", "IR", "TAXI"];

    const config = deriveLeagueConfig(payload);

    // 8 listed slots, of which IR and TAXI are not fillable at auction: 8 − 2 = 6.
    expect(config.rosterSize).toBe(6);
    expect(config.benchSlots).toBe(2);
    expect(config.flexSlots).toBe(1);
  });

  test("AC2 — a waiver type that is not FAAB has no currency, never an invented budget", () => {
    const payload = leagueFixture();
    payload.settings.type = 0; // an ordinary redraft room
    payload.settings.waiver_type = 0; // rolling priority
    payload.settings.waiver_budget = 100; // Sleeper still sends a budget; it means nothing here

    const config = deriveLeagueConfig(payload);

    expect(config.format).toBe("standard");
    expect(config.waiver.kind).toBe("rolling");
    expect(config.waiver.budget).toBeNull();
    expect(config.waiver.minBid).toBeNull();
  });
});

describe("refusing a format this project does not model", () => {
  test("AC2 — a superflex room is refused by name, not priced", () => {
    const payload = leagueFixture();
    payload.roster_positions = ["QB", "SUPER_FLEX", "RB", "WR", "TE", "K", "BN"];

    const refusal = refusalFrom(payload);

    expect(refusal).toBeInstanceOf(UnsupportedLeagueError);
    expect(refusal.reason).toMatch(/super.?flex/i);
    // The reason has to survive into the message a human reads on exit.
    expect(refusal.message).toContain(refusal.reason);
  });

  test("AC2 — IDP and DST slots are refused by name", () => {
    const withDefense = leagueFixture();
    withDefense.roster_positions = ["QB", "RB", "WR", "TE", "K", "DEF", "BN"];
    const withIdp = leagueFixture();
    withIdp.roster_positions = ["QB", "RB", "WR", "TE", "K", "LB", "BN"];

    expect(refusalFrom(withDefense).reason).toMatch(/def|dst|defen/i);
    expect(refusalFrom(withIdp).reason).toMatch(/idp|lb|defen/i);
  });

  test("AC2 — best-ball and keeper/dynasty rooms are refused by name", () => {
    const bestBall = leagueFixture();
    bestBall.settings["best_ball"] = 1;
    const keeper = leagueFixture();
    keeper.settings.type = 1; // Sleeper: 0 redraft, 1 keeper, 2 dynasty, 3 guillotine

    expect(refusalFrom(bestBall).reason).toMatch(/best.?ball/i);
    expect(refusalFrom(keeper).reason).toMatch(/keeper|dynasty/i);
  });
});
