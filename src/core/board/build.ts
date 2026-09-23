import { allocateFaab, type UnspentCurve } from "../valuation/allocate.ts";
import { restOfSeasonPoints } from "../valuation/points.ts";
import { replacementLevels, vorp } from "../valuation/replacement.ts";
import { lastMeaningfulWeek } from "../survival/last-meaningful-week.ts";
import { survivalWeights } from "../survival/weights.ts";
import { SeasonDecidedError } from "../types.ts";
import type {
  LeagueConfig,
  LeagueState,
  PlayerIndex,
  Position,
  PricedRow,
  WeeklyPoints,
} from "../types.ts";

/**
 * Assemble a week's waiver board: the pure half of the Tuesday run.
 *
 * Everything the board needs arrives as data — scored weekly points, the league's own
 * settings, the observed league state — so this function reads no clock, no file and
 * no network, and two runs over the same inputs are byte-identical.
 *
 * The order of operations is the one the sequence diagram states: weight the weeks
 * you are likely to be alive for, sum the rest of the season, set replacement level
 * against ALL players (a rostered starter still sets the bar), then price only what is
 * actually available.
 */

export type BoardDiagnostics = {
  readonly week: number;
  /**
   * The last week actually priced. In a guillotine room that is the week of the final
   * chop, which is usually earlier than the caller's NFL horizon.
   */
  readonly throughWeek: number;
  readonly liveTeams: number;
  readonly choppedTeams: number;
  readonly availablePool: number;
  readonly replacement: Record<Position, number>;
  readonly survivalWeights: readonly number[] | null;
  /** Positions priced at the floor rather than out of the pool. */
  readonly floorPositions: readonly Position[];
  readonly economy: ReturnType<typeof allocateFaab>["diagnostics"] | null;
  /**
   * The rows left off the board because they are at or below replacement — counted,
   * and with their dollars totalled.
   *
   * The frozen board keeps only the decisions, so without this the money that went to
   * everyone else would simply be missing from the file, and the economy could no
   * longer be checked from the file alone (tickets/004, AC3).
   */
  readonly dropped: {
    readonly rowCount: number;
    /** Σ `value` over the dropped rows; null when the league has no FAAB currency. */
    readonly valueSum: number | null;
  };
};

export type WaiverBoard = {
  /** Rows above replacement: the week's actual decisions. */
  readonly rows: readonly PricedRow[];
  /** Every available player, priced — what `--all` prints. */
  readonly everyRow: readonly PricedRow[];
  readonly diagnostics: BoardDiagnostics;
};

export function buildWaiverBoard(args: {
  config: LeagueConfig;
  index: PlayerIndex;
  state: LeagueState;
  /** Scored weekly points for every player, keyed by absolute week. */
  weekly: readonly WeeklyPoints[];
  /**
   * The last week of the NFL schedule. A guillotine room may stop earlier than this —
   * never later — because its season ends when one team is left.
   */
  throughWeek: number;
  /** Chops per week, from the league registry. Required for a guillotine room. */
  chopsPerWeek?: number;
  /** Positions priced at the floor, their dollars redistributed. From the registry. */
  floorPositions?: readonly Position[];
  /**
   * The measured unspent curve (tickets/007), read from the data repo by the caller.
   * Required to price a guillotine room with FAAB; a standard room never reads it.
   */
  unspentCurve?: UnspentCurve;
}): WaiverBoard {
  const { config, index, state, weekly, throughWeek, chopsPerWeek } = args;
  const floorPositions = args.floorPositions ?? [];
  const fromWeek = state.week;

  // A guillotine week is only worth what you are likely to be alive to collect. The
  // cadence is a fact about the room that Sleeper does not publish, so it is required
  // rather than assumed: at two chops a week, assuming one prices every future week
  // as twice as likely as it is.
  if (config.format === "guillotine" && chopsPerWeek === undefined) {
    throw new Error(
      `this guillotine league has no chopsPerWeek in the registry, and it cannot be ` +
        `derived from Sleeper. Add it to leagues.json in the data repo.`,
    );
  }
  const guillotine = config.format === "guillotine" && chopsPerWeek !== undefined;

  /**
   * A guillotine season ends when one team is left, so the last week worth pricing
   * comes from the room's own live-team count and cadence — not from the schedule.
   * A standard room has no cadence to derive one from and keeps the caller's horizon
   * (its own is a separate question; tickets/006, Boundary).
   */
  const pricedThroughWeek = guillotine
    ? lastMeaningfulWeek({
        week: fromWeek,
        liveTeams: state.liveTeams,
        chopsPerWeek,
        throughWeek,
      })
    : throughWeek;
  const weeksRemaining = pricedThroughWeek - fromWeek + 1;

  // With one team left the window is empty, and there is nothing here to price. Say so
  // by type, before the curve is asked for: `survivalWeights` would throw a generic
  // error that the CLI cannot tell apart from a real bug.
  if (guillotine && weeksRemaining < 1) {
    throw new SeasonDecidedError(Math.ceil((config.teams - 1) / chopsPerWeek));
  }

  const weights = guillotine
    ? survivalWeights({ liveTeams: state.liveTeams, weeksRemaining, chopsPerWeek })
    : null;

  const points = restOfSeasonPoints({
    weekly,
    fromWeek,
    throughWeek: pricedThroughWeek,
    ...(weights ? { weights } : {}),
  });

  // Replacement is set against everyone, rostered or not, at the LIVE team count.
  const replacement = replacementLevels({ points, index, config, teams: state.liveTeams });
  const vorpOf = (playerId: string): number => {
    const player = index.get(playerId);
    if (!player) return 0;
    return vorp(points.get(playerId) ?? 0, replacement[player.position]);
  };

  /**
   * A floor position is one nobody bids real money on — kickers, in both of Logan's
   * rooms. Their VORP is real (one kicker does outscore another), but the market for
   * them is not: a room with 15 teams rosters 15 of ~32 kickers, so replacement is
   * shallow and they would otherwise take the top of the board. Measured across 23
   * guillotine rooms in 2025: the top weekly bids were RB, WR, QB and TE, never a K.
   *
   * So they are excluded from the economy on both sides — they neither consume the
   * pool nor count toward the supply it is spread over — and price at the floor. Their
   * VORP is still shown, because it is true.
   */
  const isFloorPosition = (playerId: string): boolean => {
    const player = index.get(playerId);
    return player !== undefined && floorPositions.includes(player.position);
  };
  const vorpOfPriced = (playerId: string): number =>
    isFloorPosition(playerId) ? 0 : vorpOf(playerId);

  const availableVorp = new Map(state.availableIds.map((id) => [id, vorpOfPriced(id)]));

  const rosteredVorpByTeam = state.rosters
    .filter((roster) => !roster.eliminated)
    .map((roster) => roster.playerIds.reduce((sum, id) => sum + vorpOfPriced(id), 0));

  const allocation =
    state.faabPool === null
      ? null
      : allocateFaab({
          availableVorp,
          rosteredVorpByTeam,
          pool: state.faabPool,
          floor: config.waiver.minBid ?? 0,
          // Only read without a guillotine: there, releases are whole rosters.
          chopsRemaining: 0,
          ...(guillotine && weights
            ? {
                guillotine: guillotineEconomy({
                  config,
                  fromWeek,
                  pricedThroughWeek,
                  chopsPerWeek,
                  weights,
                  unspentCurve: args.unspentCurve,
                }),
              }
            : {}),
        });

  const rows: PricedRow[] = state.availableIds
    .map((playerId) => {
      const player = index.get(playerId);
      // The available pool is the index's own complement, so a miss here is a bug in
      // how the state was built — never something to paper over with a default
      // position, which would put a real player at the wrong replacement level.
      if (!player) throw new Error(`available player ${playerId} is not in the index`);
      return {
        playerId,
        position: player.position,
        points: points.get(playerId) ?? 0,
        // The shown VORP is the real one, even where the dollars are floored.
        vorp: vorpOf(playerId),
        value: allocation?.values.get(playerId) ?? null,
      };
    })
    // By value where there is money, because a floored position can out-VORP a
    // player who is actually worth bidding on; by VORP where there is none. The
    // player id breaks ties, so two runs cannot disagree about order.
    .sort(
      (a, b) =>
        (b.value ?? 0) - (a.value ?? 0) || b.vorp - a.vorp || a.playerId.localeCompare(b.playerId),
    );

  const claimable = rows.filter((row) => row.vorp > 0);
  const dropped = rows.filter((row) => row.vorp <= 0);

  return {
    rows: claimable,
    everyRow: rows,
    diagnostics: {
      week: fromWeek,
      throughWeek: pricedThroughWeek,
      liveTeams: state.liveTeams,
      choppedTeams: state.choppedTeams,
      availablePool: state.availableIds.length,
      replacement,
      survivalWeights: weights,
      floorPositions,
      economy: allocation?.diagnostics ?? null,
      dropped: {
        rowCount: dropped.length,
        valueSum:
          allocation === null ? null : dropped.reduce((sum, row) => sum + (row.value ?? 0), 0),
      },
    },
  };
}

/**
 * What the guillotine economy needs from the room (tickets/007): its chop schedule, its
 * budget, and the measured curve — each refused by name when missing rather than
 * defaulted, because a default here would be an invented number.
 *
 * The schedule is one chop per `chopsPerWeek` in each priced week, the priced window
 * ending at the final chop (tickets/006): at one a week from week 3 with 14 live teams,
 * weeks 3–15, 13 chops. Only one chop a week is supported (Logan, 2026-09-22): the
 * curve was measured per chop week, and how a second chop in the same week leaks is not
 * something anyone has looked at. Supporting it is a small change when a room needs it.
 */
function guillotineEconomy(g: {
  config: LeagueConfig;
  fromWeek: number;
  pricedThroughWeek: number;
  chopsPerWeek: number;
  weights: readonly number[];
  unspentCurve: UnspentCurve | undefined;
}) {
  if (g.chopsPerWeek !== 1) {
    throw new Error(
      `this guillotine room chops ${g.chopsPerWeek} teams a week; FAAB is priced for rooms ` +
        `that chop one a week (tickets/007). Refusing rather than guess how the rest leak.`,
    );
  }
  if (g.config.waiver.budget === null) {
    throw new Error(
      `this guillotine room has FAAB but no season budget in its settings, and the ` +
        `measured unspent curve is a share of that budget.`,
    );
  }
  if (g.unspentCurve === undefined) {
    throw new Error(
      `no measured unspent curve was given, and a guillotine room's pool cannot be priced ` +
        `without it. Expected measured/chop-unspent-v1.json in the data repo (tickets/007).`,
    );
  }

  const chopWeeks = Array.from(
    { length: g.pricedThroughWeek - g.fromWeek + 1 },
    (_, i) => g.fromWeek + i,
  );

  return {
    fromWeek: g.fromWeek,
    survivalWeights: g.weights,
    chopWeeks,
    budget: g.config.waiver.budget,
    curve: g.unspentCurve,
  };
}
