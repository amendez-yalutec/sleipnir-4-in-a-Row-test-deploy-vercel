/** Forma en JSON de turnos y partidas, tal como la define el OpenAPI 1.0.1. */
import { positionOf } from "./arbiter.js";
import { type Player, rivalOf } from "./rules.js";
import type { ArbiterState, Game, GameResult, Seat, TeamInfo } from "./types.js";
import { computeStandings } from "./standings.js";

const iso = (ms: number) => new Date(ms).toISOString();

export type Names = (seat: Seat) => string;

export const namesFrom =
  (teams: TeamInfo[]): Names =>
  (seat) =>
    seat.type === "house" ? seat.bot : (teams.find((t) => t.id === seat.id)?.name ?? seat.id);

/** `PlayerRef`: `team_id` (no `id`) y `house: true` solo en los bots de la casa. */
const playerRef = (seat: Seat, names: Names) => ({
  team_id: seat.type === "team" ? seat.id : seat.bot,
  name: names(seat),
  ...(seat.type === "house" && { house: true as const }),
});

export function turnJson(game: Game, you: Player, deadlineMs: number, names: Names) {
  const position = positionOf(game);
  const last = game.moves.at(-1);
  return {
    status: "turn" as const,
    game_id: game.id,
    match_id: game.matchId,
    kind: game.kind,
    you,
    opponent: names(game.seats[rivalOf(you)]),
    turn: game.moves.length + 1,
    board: position.board,
    moves: game.moves.map((m) => m.column),
    last_move: last ? { by: last.by, column: last.column } : null,
    legal_moves: position.legal,
    deadline_ms: deadlineMs,
    served_at: iso(game.pending!.servedAt!),
  };
}

function resultJson(result: GameResult) {
  return {
    winner: result.winner,
    reason: result.reason,
    ...(result.reason === "connect4" && { winning_cells: result.winningCells ?? [] }),
    ...(result.forfeitedBy !== undefined && { forfeited_by: result.forfeitedBy }),
    ...(result.ms !== undefined && { ms: result.ms }),
    ...(result.column !== undefined && { column: result.column }),
    ...(result.waitedMs !== undefined && { waited_ms: result.waitedMs }),
  };
}

/** `GameSummary`: la partida sin tablero (`GET /api/games`). */
export function gameSummary(game: Game, names: Names) {
  return {
    game_id: game.id,
    match_id: game.matchId,
    kind: game.kind,
    series: game.series,
    status: game.result ? ("finished" as const) : game.startedAt === null ? ("scheduled" as const) : ("playing" as const),
    players: { "1": playerRef(game.seats[1], names), "2": playerRef(game.seats[2], names) },
    moves: game.moves,
    current: game.result || game.startedAt === null ? null : ((game.moves.length % 2 === 0 ? 1 : 2) as Player),
    result: game.result && resultJson(game.result),
    started_at: game.startedAt === null ? null : iso(game.startedAt),
    finished_at: game.finishedAt === null ? null : iso(game.finishedAt),
  };
}

/** `Game`: el resumen más el tablero (`GET /api/games/{game_id}`). */
export const gameJson = (game: Game, names: Names) => ({ ...gameSummary(game, names), board: positionOf(game).board });

/**
 * Snapshot del torneo para `/api/state` y `/api/live`. El OpenAPI solo dice "object"; estos campos son
 * los mismos que usa el mock del equipo (phase, announcement, teams, standings, live, recent, series).
 */
export function stateSnapshot(state: ArbiterState, teams: TeamInfo[], extra: Record<string, unknown>) {
  const names = namesFrom(teams);
  const recentFirst = [...state.games].reverse();
  const standings = computeStandings(teams, state.games);
  const series = state.playoffs.map((s) => ({
    series: s.name,
    players: s.seats.map((seat) => playerRef(seat, names)),
    wins: s.wins,
    winner: s.winner === null ? null : playerRef(s.seats[s.winner], names),
    games: state.games.filter((g) => g.series === s.name).map((g) => g.id),
  }));

  return {
    phase: state.phase,
    announcement: state.announcement,
    ...extra,
    teams: teams.map((t) => ({ id: t.id, name: t.name, ...(t.test && { test: true }) })),
    standings,
    live: recentFirst.filter((g) => !g.result && g.startedAt !== null).map((g) => gameJson(g, names)),
    scheduled: state.games.filter((g) => g.startedAt === null && !g.result).length,
    recent: recentFirst
      .filter((g) => g.result)
      .slice(0, 10)
      .map((g) => gameSummary(g, names)),
    series,
  };
}
