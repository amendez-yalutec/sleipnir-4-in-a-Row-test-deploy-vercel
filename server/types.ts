/** Estado del árbitro. Todo es JSON serializable para poder guardarlo en Redis. */
import type { CellPair, Player } from "./rules.js";

export const HOUSE_BOTS = ["casa-aleatorio", "casa-basico"] as const;
export type HouseBot = (typeof HOUSE_BOTS)[number];
export const isHouseBot = (name: unknown): name is HouseBot =>
  typeof name === "string" && (HOUSE_BOTS as readonly string[]).includes(name);

export const GAME_KINDS = ["practice", "friendly", "league", "third_place", "final"] as const;
export type GameKind = (typeof GAME_KINDS)[number];

export const PHASES = ["practice", "frozen", "league", "playoffs", "finished"] as const;
export type Phase = (typeof PHASES)[number];

export type EndReason = "connect4" | "draw" | "illegal_move" | "timeout" | "absent" | "admin";

export interface TeamInfo {
  id: string;
  name: string;
  token: string;
  members: string[];
  /** Equipo de prueba: juega, pero no aparece en la tabla (standing null en /api/me). */
  test?: boolean;
}

export type Seat = { type: "team"; id: string } | { type: "house"; bot: HouseBot };

export interface MoveRecord {
  turn: number;
  by: Player;
  column: number;
  ms: number;
}

export interface GameResult {
  winner: Player | null;
  reason: EndReason;
  winningCells?: CellPair[];
  forfeitedBy?: Player;
  ms?: number;
  column?: unknown;
  waitedMs?: number;
}

export interface Pending {
  availableAt: number;
  servedAt: number | null;
}

export interface Game {
  id: string;
  matchId: string | null;
  kind: GameKind;
  series: "third" | "final" | null;
  seats: { 1: Seat; 2: Seat };
  moves: MoveRecord[];
  startedAt: number;
  pending: Pending | null;
  result: GameResult | null;
  finishedAt: number | null;
  /** Si se perdió por tiempo: cuándo venció el plazo (para responder 400 timeout a la jugada tardía). */
  deadlineMissedAt: number | null;
}

export interface SubmissionRecord {
  repo_url: string;
  commit: string;
  registered_at: string;
}

export interface ArbiterState {
  version: 1;
  seq: number;
  phase: Phase;
  announcement: string | null;
  /** De la más antigua a la más reciente. */
  games: Game[];
  submissions: Record<string, SubmissionRecord>;
}

export const initialState = (): ArbiterState => ({
  version: 1,
  seq: 0,
  phase: "practice",
  announcement: null,
  games: [],
  submissions: {},
});

export interface Reply {
  status: number;
  body: unknown;
}

export type ErrorCode =
  | "illegal_move"
  | "timeout"
  | "not_your_turn"
  | "unauthorized"
  | "practice_closed"
  | "submissions_closed"
  | "unknown_game"
  | "validation"
  | "not_found"
  | "internal";

export const errorReply = (status: number, error: ErrorCode, message: string): Reply => ({
  status,
  body: { ok: false, error, message },
});
