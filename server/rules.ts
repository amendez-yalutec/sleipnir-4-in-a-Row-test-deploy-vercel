/**
 * Reglas del 4 en línea 8×7 con la forma del OpenAPI: board[fila][columna], fila 0 abajo,
 * columnas 0–7. 0 vacío, 1 jugador que abrió, 2 el otro.
 */
export const ROWS = 7;
export const COLS = 8;

export type Player = 1 | 2;
export type Cell = 0 | Player;
export type Board = Cell[][];
/** [fila, columna], como `winning_cells` del OpenAPI. */
export type CellPair = [number, number];

export const rivalOf = (player: Player): Player => (player === 1 ? 2 : 1);
export const toMove = (movesPlayed: number): Player => (movesPlayed % 2 === 0 ? 1 : 2);

export function emptyBoard(): Board {
  return Array.from({ length: ROWS }, () => Array<Cell>(COLS).fill(0));
}

/** Fila donde cae una ficha en la columna, o -1 si está llena. */
export function dropRow(board: Board, column: number): number {
  for (let row = 0; row < ROWS; row++) if (board[row][column] === 0) return row;
  return -1;
}

export function legalMoves(board: Board): number[] {
  const legal: number[] = [];
  for (let c = 0; c < COLS; c++) if (board[ROWS - 1][c] === 0) legal.push(c);
  return legal;
}

const DIRECTIONS: [number, number][] = [
  [0, 1],
  [1, 0],
  [1, 1],
  [1, -1],
];

/** Celdas de la línea de 4 o más que pasa por (fila, columna), o null. */
export function winningLine(board: Board, row: number, column: number): CellPair[] | null {
  const player = board[row][column];
  if (player === 0) return null;
  for (const [dr, dc] of DIRECTIONS) {
    const back: CellPair[] = [];
    const ahead: CellPair[] = [];
    for (const [sign, list] of [
      [-1, back],
      [1, ahead],
    ] as const) {
      let r = row + dr * sign;
      let c = column + dc * sign;
      while (r >= 0 && r < ROWS && c >= 0 && c < COLS && board[r][c] === player) {
        list.push([r, c]);
        r += dr * sign;
        c += dc * sign;
      }
    }
    const line = [...back.reverse(), [row, column] as CellPair, ...ahead];
    if (line.length >= 4) return line;
  }
  return null;
}

export interface Position {
  board: Board;
  toMove: Player;
  legal: number[];
  /** Resultado de la última jugada: línea ganadora, empate o en curso. */
  status: "playing" | "won" | "draw";
  winningCells: CellPair[];
}

/** Reconstruye la posición desde la lista de columnas jugadas (ya validadas). */
export function replay(columns: readonly number[]): Position {
  const board = emptyBoard();
  let status: Position["status"] = "playing";
  let winningCells: CellPair[] = [];
  columns.forEach((column, i) => {
    const row = dropRow(board, column);
    board[row][column] = toMove(i);
    const line = winningLine(board, row, column);
    if (line) {
      status = "won";
      winningCells = line;
    }
  });
  const legal = status === "playing" ? legalMoves(board) : [];
  if (status === "playing" && legal.length === 0) status = "draw";
  return { board, toMove: toMove(columns.length), legal, status, winningCells };
}
