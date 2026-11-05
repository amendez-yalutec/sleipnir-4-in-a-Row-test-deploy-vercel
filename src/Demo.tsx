import { useEffect, useState } from "react";
import { COLS, ROWS, type Board, type Player, botMove, drop, emptyBoard, legalColumns, winningLine } from "./game";

type Mode = "bot" | "local";
type Status = { kind: "playing" } | { kind: "win"; player: Player; line: [number, number][] } | { kind: "draw" };

const NAMES: Record<Player, string> = { 1: "Naranja", 2: "Azul" };

export default function Demo() {
  const [board, setBoard] = useState<Board>(emptyBoard);
  const [turn, setTurn] = useState<Player>(1);
  const [status, setStatus] = useState<Status>({ kind: "playing" });
  const [mode, setMode] = useState<Mode>("bot");
  const [hover, setHover] = useState<number | null>(null);
  const [last, setLast] = useState<[number, number] | null>(null);
  const [moves, setMoves] = useState(0);

  const botTurn = mode === "bot" && turn === 2 && status.kind === "playing";

  function play(col: number) {
    if (status.kind !== "playing") return;
    const result = drop(board, col, turn);
    if (!result) return;
    setBoard(result.board);
    setLast([col, result.row]);
    setMoves((m) => m + 1);
    const line = winningLine(result.board, col, result.row);
    if (line) setStatus({ kind: "win", player: turn, line });
    else if (legalColumns(result.board).length === 0) setStatus({ kind: "draw" });
    else setTurn(turn === 1 ? 2 : 1);
  }

  useEffect(() => {
    if (!botTurn) return;
    const id = setTimeout(() => play(botMove(board, 2)), 450);
    return () => clearTimeout(id);
  }, [botTurn, board]);

  function reset(nextMode: Mode = mode) {
    setMode(nextMode);
    setBoard(emptyBoard());
    setTurn(1);
    setStatus({ kind: "playing" });
    setLast(null);
    setMoves(0);
  }

  const isWinning = (c: number, r: number) =>
    status.kind === "win" && status.line.some(([lc, lr]) => lc === c && lr === r);
  const canClick = status.kind === "playing" && !botTurn;

  let message: string;
  if (status.kind === "win") message = `¡Gana ${NAMES[status.player]}!`;
  else if (status.kind === "draw") message = "Empate: tablero lleno";
  else if (botTurn) message = "El bot está pensando…";
  else message = `Turno de ${NAMES[turn]}`;

  return (
    <section className="demo">
      <p className="subtitle">Juego local en el navegador, sin el árbitro.</p>

      <div className="controls" role="group" aria-label="Modo de juego">
        <button className={mode === "bot" ? "active" : ""} onClick={() => reset("bot")}>
          Contra el bot
        </button>
        <button className={mode === "local" ? "active" : ""} onClick={() => reset("local")}>
          Dos jugadores
        </button>
        <button onClick={() => reset()}>Reiniciar</button>
      </div>

      <p className={`status p${status.kind === "win" ? status.player : turn}`} aria-live="polite">
        <span className="dot" /> {message}
      </p>

      <div className="board-wrap">
        <div className="col-labels" aria-hidden="true">
          {Array.from({ length: COLS }, (_, c) => (
            <span key={c} className={hover === c && canClick ? `hint p${turn}` : ""}>
              {c + 1}
            </span>
          ))}
        </div>
        <div className="board" onMouseLeave={() => setHover(null)}>
          {Array.from({ length: COLS }, (_, c) => {
            const full = board[c][ROWS - 1] !== 0;
            return (
              <button
                key={c}
                className="column"
                disabled={!canClick || full}
                onMouseEnter={() => setHover(c)}
                onClick={() => play(c)}
                aria-label={`Columna ${c + 1}${full ? " (llena)" : ""}`}
              >
                {Array.from({ length: ROWS }, (_, i) => {
                  const r = ROWS - 1 - i; // fila 0 abajo
                  const cell = board[c][r];
                  const cls = [
                    "cell",
                    cell ? `p${cell}` : "",
                    last && last[0] === c && last[1] === r ? "drop" : "",
                    isWinning(c, r) ? "win" : "",
                  ].join(" ");
                  return <span key={r} className={cls} style={{ ["--fall" as string]: i + 1 }} />;
                })}
              </button>
            );
          })}
        </div>
      </div>

      <p className="meta">
        Jugadas: {moves} · Columnas 1–8 en pantalla (0–7 en código) · Fila 0 abajo
      </p>

      <p className="note">
        Aquí las reglas corren en el navegador solo para el demo. En el torneo las aplica el árbitro.
      </p>
    </section>
  );
}
