import { allocateFaab } from "../valuation/allocate.ts";
import { restOfSeasonPoints } from "../valuation/points.ts";
import { replacementLevels, vorp } from "../valuation/replacement.ts";
import { survivalWeights } from "../survival/weights.ts";
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
  readonly throughWeek: number;
  readonly liveTeams: number;
  readonly choppedTeams: number;
  readonly availablePool: number;
  readonly replacement: Record<Position, number>;
  readonly survivalWeights: readonly number[] | null;
  /** Positions priced at the floor rather than out of the pool. */
  readonly floorPositions: readonly Position[];
  readonly economy: {
    readonly pool: number;
    readonly distributable: number;
    readonly availableVorp: number;
    readonly rosteredVorpPerTeam: number;
    readonly chopsRemaining: number;
    readonly supply: number;
    readonly dollarsPerVorp: number;
  } | null;
  /** Rows left off the printed board because they are at or below replacement. */
  readonly belowReplacement: number;
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
  /** The last week of the season being priced. */
  throughWeek: number;
  /** Chops per week, from the league registry. Required for a guillotine room. */
  chopsPerWeek?: number;
  /** Positions priced at the floor, their dollars redistributed. From the registry. */
  floorPositions?: readonly Position[];
}): WaiverBoard {
  const { config, index, state, weekly, throughWeek, chopsPerWeek } = args;
  const floorPositions = args.floorPositions ?? [];
  const fromWeek = state.week;
  const weeksRemaining = throughWeek - fromWeek + 1;

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
  const weights =
    config.format === "guillotine" && chopsPerWeek !== undefined
      ? survivalWeights({ liveTeams: state.liveTeams, weeksRemaining, chopsPerWeek })
      : null;

  const points = restOfSeasonPoints({
    weekly,
    fromWeek,
    throughWeek,
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

  const allocation =
    state.faabPool === null
      ? null
      : allocateFaab({
          availableVorp,
          rosteredVorpByTeam: state.rosters
            .filter((roster) => !roster.eliminated)
            .map((roster) => roster.playerIds.reduce((sum, id) => sum + vorpOfPriced(id), 0)),
          pool: state.faabPool,
          floor: config.waiver.minBid ?? 0,
          // Every remaining chop releases a whole roster into the pool. The season
          // ends with one survivor however fast the room chops, so the COUNT of
          // remaining chops does not depend on the cadence — only their timing does.
          chopsRemaining: config.format === "guillotine" ? state.liveTeams - 1 : 0,
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

  return {
    rows: claimable,
    everyRow: rows,
    diagnostics: {
      week: fromWeek,
      throughWeek,
      liveTeams: state.liveTeams,
      choppedTeams: state.choppedTeams,
      availablePool: state.availableIds.length,
      replacement,
      survivalWeights: weights,
      floorPositions,
      economy: allocation?.diagnostics ?? null,
      belowReplacement: rows.length - claimable.length,
    },
  };
}
