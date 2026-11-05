/**
 * Operaciones del árbitro sobre el estado, sin HTTP ni almacenamiento. Mutan `state` en sitio; quien
 * llama decide cuándo guardarlo. Mismas reglas de operación que el mock del equipo
 * (tools/mock-arbiter): reloj de 3 s desde served_at, ausencia a los 30 s, bots de la casa.
 */
import { type Board, type Player, legalMoves, replay, rivalOf, winningLine, dropRow } from "./rules.js";
import {
  type ArbiterState,
  type EndReason,
  type Game,
  type GameKind,
  type GameResult,
  type HouseBot,
  type Reply,
  type Seat,
  type TeamInfo,
  errorReply,
} from "./types.js";

export interface Ctx {
  now: number;
  deadlineMs: number;
  absenceMs: number;
}

/** Partidas terminadas que se conservan (el estado vive en una sola llave de Redis). */
const MAX_FINISHED_GAMES = 300;

export const notYourTurn = (gameId: string) =>
  errorReply(409, "not_your_turn", `La partida ${gameId} no tiene un turno pendiente para tu equipo.`);

export function seatOf(game: Game, teamId: string): Player | null {
  for (const p of [1, 2] as const) {
    const seat = game.seats[p];
    if (seat.type === "team" && seat.id === teamId) return p;
  }
  return null;
}

export const positionOf = (game: Game) => replay(game.moves.map((m) => m.column));

function finish(game: Game, result: GameResult, now: number): void {
  game.pending = null;
  game.result = result;
  game.finishedAt = now;
}

function forfeit(game: Game, loser: Player, reason: EndReason, now: number, details: Partial<GameResult> = {}) {
  finish(game, { winner: rivalOf(loser), reason, forfeitedBy: loser, ...details }, now);
}

/** Registra una jugada ya validada y cierra la partida si gana o empata. */
function recordMove(game: Game, column: number, ms: number, now: number) {
  const before = positionOf(game);
  game.moves.push({ turn: game.moves.length + 1, by: before.toMove, column, ms });
  game.pending = null;
  const after = positionOf(game);
  if (after.status === "won") finish(game, { winner: before.toMove, reason: "connect4", winningCells: after.winningCells }, now);
  else if (after.status === "draw") finish(game, { winner: null, reason: "draw" }, now);
  return after;
}

/** casa-aleatorio juega al azar; casa-basico gana y bloquea cuatros inmediatos. */
export function houseMove(bot: HouseBot, board: Board, player: Player, random = Math.random): number {
  const legal = legalMoves(board);
  if (bot === "casa-basico") {
    const winsFor = (p: Player) =>
      legal.find((column) => {
        const row = dropRow(board, column);
        const copy = board.map((r) => r.slice());
        copy[row][column] = p;
        return winningLine(copy, row, column) !== null;
      });
    const urgent = winsFor(player) ?? winsFor(rivalOf(player));
    if (urgent !== undefined) return urgent;
  }
  return legal[Math.floor(random() * legal.length)];
}

/** Juegan los bots de la casa hasta que le toque a un equipo; entonces el turno queda disponible. */
function advance(game: Game, now: number): void {
  while (!game.result) {
    const position = positionOf(game);
    const seat = game.seats[position.toMove];
    if (seat.type === "team") {
      game.pending = { availableAt: now, servedAt: null };
      return;
    }
    recordMove(game, houseMove(seat.bot, position.board, position.toMove), 0, now);
  }
}

function matchIdFor(kind: GameKind, n: number): string | null {
  if (kind === "practice") return null;
  if (kind === "friendly") return "amistoso";
  if (kind === "league") return `m_${String(n).padStart(2, "0")}`;
  return kind === "final" ? `final_${n}` : `third_${n}`;
}

function prune(state: ArbiterState): void {
  const finished = state.games.filter((g) => g.result);
  if (finished.length <= MAX_FINISHED_GAMES) return;
  const drop = new Set(finished.slice(0, finished.length - MAX_FINISHED_GAMES).map((g) => g.id));
  state.games = state.games.filter((g) => !drop.has(g.id));
}

export function createGame(state: ArbiterState, kind: GameKind, first: Seat, second: Seat, now: number): Game {
  const n = ++state.seq;
  const game: Game = {
    id: kind === "practice" ? `g_p_${String(n).padStart(2, "0")}` : `g_${n}`,
    matchId: matchIdFor(kind, n),
    kind,
    series: kind === "third_place" ? "third" : kind === "final" ? "final" : null,
    seats: { 1: first, 2: second },
    moves: [],
    startedAt: now,
    pending: null,
    result: null,
    finishedAt: null,
    deadlineMissedAt: null,
  };
  state.games.push(game);
  advance(game, now);
  prune(state);
  return game;
}

export const practiceOpen = (state: ArbiterState) => state.phase === "practice";
export const submissionsOpen = (state: ArbiterState) => state.phase === "practice";

export function createPractice(state: ArbiterState, team: TeamInfo, opponent: HouseBot, first: Player, now: number): Reply {
  if (!practiceOpen(state)) return errorReply(423, "practice_closed", "Las prácticas están cerradas.");
  const mine: Seat = { type: "team", id: team.id };
  const house: Seat = { type: "house", bot: opponent };
  const game = first === 1 ? createGame(state, "practice", mine, house, now) : createGame(state, "practice", house, mine, now);
  return { status: 201, body: { game_id: game.id, you: first } };
}

/** El jugador del equipo si tiene el turno pendiente en esa partida. */
export function pendingSeat(game: Game, teamId: string): Player | null {
  if (!game.pending || game.result) return null;
  const seat = seatOf(game, teamId);
  return seat !== null && game.moves.length % 2 === seat - 1 ? seat : null;
}

/** ¿Hay alguna partida con ausencia o plazo vencido que cerrar? */
export function needsSweep(state: ArbiterState, ctx: Ctx): boolean {
  return state.games.some((game) => {
    const { pending } = game;
    if (!pending || game.result) return false;
    return pending.servedAt === null
      ? ctx.now - pending.availableAt > ctx.absenceMs
      : ctx.now > pending.servedAt + ctx.deadlineMs;
  });
}

/** Cierra partidas por ausencia (turno sin recoger) o por plazo vencido. */
export function sweep(state: ArbiterState, ctx: Ctx): boolean {
  let changed = false;
  for (const game of state.games) {
    const { pending } = game;
    if (!pending || game.result) continue;
    const seat: Player = game.moves.length % 2 === 0 ? 1 : 2;
    if (pending.servedAt === null) {
      if (ctx.now - pending.availableAt > ctx.absenceMs) {
        forfeit(game, seat, "absent", ctx.now, { waitedMs: ctx.now - pending.availableAt });
        changed = true;
      }
    } else if (ctx.now > pending.servedAt + ctx.deadlineMs) {
      game.deadlineMissedAt = pending.servedAt + ctx.deadlineMs;
      forfeit(game, seat, "timeout", ctx.now, { ms: ctx.now - pending.servedAt });
      changed = true;
    }
  }
  return changed;
}

/** El turno pendiente más antiguo del equipo (quien lo entrega arranca el reloj). */
export function findTurn(state: ArbiterState, teamId: string): { game: Game; seat: Player } | null {
  let best: { game: Game; seat: Player } | null = null;
  for (const game of state.games) {
    const seat = pendingSeat(game, teamId);
    if (seat === null || !game.pending) continue;
    if (!best || game.pending.availableAt < best.game.pending!.availableAt) best = { game, seat };
  }
  return best;
}

export function pendingTurns(state: ArbiterState, teamId: string): string[] {
  return state.games.filter((g) => pendingSeat(g, teamId) !== null).map((g) => g.id);
}

export function submitMove(state: ArbiterState, team: TeamInfo, gameId: string, column: number, ctx: Ctx): Reply {
  sweep(state, ctx);
  const game = state.games.find((g) => g.id === gameId);
  if (!game) return errorReply(409, "unknown_game", `La partida ${gameId} no existe.`);
  const seat = seatOf(game, team.id);
  if (seat === null) return notYourTurn(gameId);
  if (game.result) {
    const lostOnTime = game.result.reason === "timeout" && game.result.forfeitedBy === seat;
    if (lostOnTime && game.deadlineMissedAt !== null && game.moves.length % 2 === seat - 1) {
      const late = ctx.now - game.deadlineMissedAt;
      return errorReply(400, "timeout", `La jugada llegó ${late} ms después del límite.`);
    }
    return notYourTurn(gameId);
  }
  if (pendingSeat(game, team.id) === null || !game.pending) return notYourTurn(gameId);

  // sweep() ya cerró la partida si el plazo venció: aquí la jugada llegó a tiempo.
  const servedAt = game.pending.servedAt ?? ctx.now;
  const ms = ctx.now - servedAt;
  if (!positionOf(game).legal.includes(column)) {
    forfeit(game, seat, "illegal_move", ctx.now, { ms, column });
    return errorReply(400, "illegal_move", `La columna ${column} está llena.`);
  }

  const after = recordMove(game, column, ms, ctx.now);
  const played = game.moves.length;
  advance(game, ctx.now);
  return {
    status: 200,
    body: {
      ok: true,
      state: after.status,
      // Número de la siguiente jugada, o de la última si la partida terminó.
      turn: after.status === "playing" ? played + 1 : played,
      ...(after.status === "won" && { winning_cells: after.winningCells }),
    },
  };
}

/** El árbitro da la partida por perdida (`reason: admin`). */
export function adminForfeit(state: ArbiterState, gameId: string, loser: Player, now: number): Reply {
  const game = state.games.find((g) => g.id === gameId);
  if (!game) return errorReply(404, "unknown_game", "No existe.");
  if (game.result) return errorReply(409, "validation", "La partida ya terminó.");
  forfeit(game, loser, "admin", now);
  return { status: 200, body: { ok: true } };
}
