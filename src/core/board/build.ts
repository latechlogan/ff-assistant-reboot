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
  readonly rows: readonly PricedRow[];
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
}): WaiverBoard {
  const { config, index, state, weekly, throughWeek } = args;
  const fromWeek = state.week;
  const weeksRemaining = throughWeek - fromWeek + 1;

  // A guillotine week is only worth what you are likely to be alive to collect.
  const weights =
    config.format === "guillotine"
      ? survivalWeights({ liveTeams: state.liveTeams, weeksRemaining, chopsPerWeek: 1 })
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

  const availableVorp = new Map(state.availableIds.map((id) => [id, vorpOf(id)]));

  const allocation =
    state.faabPool === null
      ? null
      : allocateFaab({
          availableVorp,
          rosteredVorpByTeam: state.rosters
            .filter((roster) => !roster.eliminated)
            .map((roster) => roster.playerIds.reduce((sum, id) => sum + vorpOf(id), 0)),
          pool: state.faabPool,
          floor: config.waiver.minBid ?? 0,
          // Every remaining chop releases a whole roster into the pool.
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
        vorp: availableVorp.get(playerId) ?? 0,
        value: allocation?.values.get(playerId) ?? null,
      };
    })
    // Value first where there is money, VORP otherwise; the player id breaks ties so
    // two runs cannot disagree about order.
    .sort((a, b) => b.vorp - a.vorp || a.playerId.localeCompare(b.playerId));

  const claimable = rows.filter((row) => row.vorp > 0);

  return {
    rows: claimable,
    diagnostics: {
      week: fromWeek,
      throughWeek,
      liveTeams: state.liveTeams,
      choppedTeams: state.choppedTeams,
      availablePool: state.availableIds.length,
      replacement,
      survivalWeights: weights,
      economy: allocation?.diagnostics ?? null,
      belowReplacement: rows.length - claimable.length,
    },
  };
}
