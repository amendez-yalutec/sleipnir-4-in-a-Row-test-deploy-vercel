// Reglas mínimas del 4 en línea 8×7 para el demo visual.
// En el proyecto real las reglas viven en el backend; aquí van en el cliente
// solo para poder desplegar un demo estático en Vercel.

export const COLS = 8;
export const ROWS = 7;

export type Player = 1 | 2;
export type Cell = 0 | Player;
/** board[col][row], con la fila 0 abajo. Columnas 0–7 en código, 1–8 en pantalla. */
export type Board = Cell[][];

export function emptyBoard(): Board {
  return Array.from({ length: COLS }, () => Array<Cell>(ROWS).fill(0));
}

export function legalColumns(board: Board): number[] {
  const cols: number[] = [];
  for (let c = 0; c < COLS; c++) if (board[c][ROWS - 1] === 0) cols.push(c);
  return cols;
}

export function drop(board: Board, col: number, player: Player): { board: Board; row: number } | null {
  const row = board[col].indexOf(0);
  if (row === -1) return null;
  const next = board.map((column) => column.slice());
  next[col][row] = player;
  return { board: next, row };
}

const DIRECTIONS: [number, number][] = [
  [1, 0],
  [0, 1],
  [1, 1],
  [1, -1],
];

/** Devuelve las 4+ celdas ganadoras que pasan por (col,row), o null. */
export function winningLine(board: Board, col: number, row: number): [number, number][] | null {
  const player = board[col][row];
  if (player === 0) return null;
  for (const [dc, dr] of DIRECTIONS) {
    const line: [number, number][] = [[col, row]];
    for (const sign of [1, -1]) {
      let c = col + dc * sign;
      let r = row + dr * sign;
      while (c >= 0 && c < COLS && r >= 0 && r < ROWS && board[c][r] === player) {
        line.push([c, r]);
        c += dc * sign;
        r += dr * sign;
      }
    }
    if (line.length >= 4) return line;
  }
  return null;
}

/** Bot sencillo: gana si puede, bloquea si debe, evita regalar, prefiere el centro. */
export function botMove(board: Board, me: Player): number {
  const rival: Player = me === 1 ? 2 : 1;
  const legal = legalColumns(board);
  const winsWith = (b: Board, p: Player) =>
    legalColumns(b).filter((c) => {
      const r = drop(b, c, p)!;
      return winningLine(r.board, c, r.row) !== null;
    });

  const win = winsWith(board, me);
  if (win.length) return win[0];
  const block = winsWith(board, rival);
  if (block.length) return block[0];

  const safe = legal.filter((c) => winsWith(drop(board, c, me)!.board, rival).length === 0);
  const pool = safe.length ? safe : legal;
  const center = (COLS - 1) / 2;
  pool.sort((a, b) => Math.abs(a - center) - Math.abs(b - center) + (Math.random() - 0.5) * 0.6);
  return pool[0];
}
