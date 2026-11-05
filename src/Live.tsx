import { useEffect, useState } from "react";

// Formas del snapshot de /api/state y /api/live (ver server/json.ts). Los nombres de equipo son
// texto no confiable: solo se muestran como texto de React, nunca como HTML.
type Player = 1 | 2;
type PlayerRef = { team_id: string; name: string; house?: true };
type Result = {
  winner: Player | null;
  reason: string;
  winning_cells?: [number, number][];
  forfeited_by?: Player;
  ms?: number;
  waited_ms?: number;
  column?: unknown;
};
type GameSummary = {
  game_id: string;
  kind: string;
  status: string;
  players: Record<"1" | "2", PlayerRef>;
  moves: { turn: number; by: Player; column: number; ms?: number }[];
  current: Player | null;
  result: Result | null;
  started_at: string | null;
  finished_at: string | null;
};
type Game = GameSummary & { board: number[][] };
type Standing = { position: number; team: { id: string; name: string }; played: number; won: number; drawn: number; lost: number; points: number };
type Snapshot = {
  phase: string;
  announcement: string | null;
  rules: { deadline_ms: number; absence_ms: number };
  storage: "memory" | "redis";
  shared_state: boolean;
  standings: Standing[];
  live: Game[];
  recent: GameSummary[];
};

const PHASES: Record<string, string> = {
  practice: "Prácticas",
  frozen: "Congelado",
  league: "Liga",
  playoffs: "Playoffs",
  finished: "Terminado",
};
const KINDS: Record<string, string> = {
  practice: "práctica",
  friendly: "amistoso",
  league: "liga",
  third_place: "tercer lugar",
  final: "final",
};
const REASONS: Record<string, string> = {
  connect4: "cuatro en línea",
  draw: "empate",
  illegal_move: "jugada ilegal",
  timeout: "se le acabó el tiempo",
  absent: "ausencia",
  admin: "decisión del árbitro",
};

function MiniBoard({ board, winning }: { board: number[][]; winning?: [number, number][] }) {
  const isWin = (r: number, c: number) => winning?.some(([wr, wc]) => wr === r && wc === c) ?? false;
  return (
    <div className="mini-board" role="img" aria-label="Tablero">
      {[...board].reverse().map((row, i) => {
        const r = board.length - 1 - i; // fila 0 abajo
        return row.map((cell, c) => <span key={`${r}-${c}`} className={`mini-cell ${cell ? `p${cell}` : ""} ${isWin(r, c) ? "win" : ""}`} />);
      })}
    </div>
  );
}

function Players({ game }: { game: GameSummary }) {
  return (
    <div className="players">
      {(["1", "2"] as const).map((p) => (
        <span key={p} className={`player p${p} ${game.current === Number(p) ? "to-move" : ""}`}>
          <span className="dot" />
          {game.players[p].name}
          {game.players[p].house && <small> (casa)</small>}
        </span>
      ))}
    </div>
  );
}

function resultText(game: GameSummary): string {
  const r = game.result;
  if (!r) return "";
  if (r.winner === null) return "Empate";
  const name = game.players[String(r.winner) as "1" | "2"].name;
  let detail = REASONS[r.reason] ?? r.reason;
  if (r.reason === "timeout" && r.ms !== undefined) detail += ` (${r.ms} ms)`;
  if (r.reason === "absent" && r.waited_ms !== undefined) detail += ` (${Math.round(r.waited_ms / 1000)} s)`;
  if (r.reason === "illegal_move" && r.column !== undefined) detail += ` (columna ${String(r.column)})`;
  return `Gana ${name} · ${detail}`;
}

function Replay({ id, onClose }: { id: string; onClose: () => void }) {
  const [game, setGame] = useState<Game | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    fetch(`/api/games/${encodeURIComponent(id)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setGame)
      .catch(() => setError(true));
  }, [id]);
  return (
    <div className="card replay">
      <div className="card-head">
        <strong>Partida {id}</strong>
        <button className="link" onClick={onClose}>
          Cerrar
        </button>
      </div>
      {error && <p className="muted">No se pudo cargar la partida.</p>}
      {game && (
        <>
          <Players game={game} />
          <MiniBoard board={game.board} winning={game.result?.winning_cells} />
          <p className="muted">
            {resultText(game) || "En curso"} · {game.moves.length} jugadas · columnas:{" "}
            {game.moves.map((m) => m.column + 1).join(" ")}
          </p>
        </>
      )}
    </div>
  );
}

export default function Live() {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [connected, setConnected] = useState(false);
  const [replay, setReplay] = useState<string | null>(null);

  useEffect(() => {
    const source = new EventSource("/api/live");
    source.addEventListener("state", (event) => {
      setSnap(JSON.parse((event as MessageEvent<string>).data) as Snapshot);
      setConnected(true);
    });
    source.onerror = () => setConnected(false);
    return () => source.close();
  }, []);

  const origin = typeof window === "undefined" ? "" : window.location.origin;

  return (
    <section className="live">
      <div className="live-bar">
        <span className={`badge ${connected ? "on" : ""}`}>{connected ? "● En vivo" : "○ Conectando…"}</span>
        {snap && <span className="badge">{PHASES[snap.phase] ?? snap.phase}</span>}
        {snap && (
          <span className="muted">
            {snap.rules.deadline_ms / 1000} s por jugada · {snap.rules.absence_ms / 1000} s de ausencia
          </span>
        )}
      </div>

      {snap && !snap.shared_state && (
        <p className="warn">
          Este árbitro guarda el estado en memoria y en Vercel cada instancia tiene el suyo. Conecta Upstash Redis
          (Vercel → Storage) para que todas las rutas vean las mismas partidas.
        </p>
      )}
      {snap?.announcement && <p className="announce">{snap.announcement}</p>}

      {replay && <Replay id={replay} onClose={() => setReplay(null)} />}

      <h2>Partidas en curso</h2>
      {snap && snap.live.length === 0 && <p className="muted">No hay partidas en curso. Crea una práctica con tu bot.</p>}
      <div className="games">
        {snap?.live.map((game) => (
          <article key={game.game_id} className="card">
            <div className="card-head">
              <span>
                {game.game_id} · {KINDS[game.kind] ?? game.kind}
              </span>
              <span className="muted">jugada {game.moves.length + 1}</span>
            </div>
            <Players game={game} />
            <MiniBoard board={game.board} />
          </article>
        ))}
      </div>

      <div className="two-cols">
        <div>
          <h2>Posiciones</h2>
          <table className="standings">
            <thead>
              <tr>
                <th>#</th>
                <th className="left">Equipo</th>
                <th title="Jugadas">PJ</th>
                <th title="Victorias">V</th>
                <th title="Empates">E</th>
                <th title="Derrotas">D</th>
                <th title="Puntos">Pts</th>
              </tr>
            </thead>
            <tbody>
              {snap?.standings.map((row) => (
                <tr key={row.team.id}>
                  <td>{row.position}</td>
                  <td className="left">{row.team.name}</td>
                  <td>{row.played}</td>
                  <td>{row.won}</td>
                  <td>{row.drawn}</td>
                  <td>{row.lost}</td>
                  <td>
                    <strong>{row.points}</strong>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted small">Liga: V 3 · E 1 · D 0. Desempates: puntos, enfrentamiento directo, diferencia V−D y sorteo.</p>
        </div>

        <div>
          <h2>Últimos resultados</h2>
          {snap && snap.recent.length === 0 && <p className="muted">Todavía no termina ninguna partida.</p>}
          <ul className="recent">
            {snap?.recent.map((game) => (
              <li key={game.game_id}>
                <button className="link" onClick={() => setReplay(game.game_id)}>
                  {game.players["1"].name} vs {game.players["2"].name}
                </button>
                <span className="muted small">
                  {KINDS[game.kind] ?? game.kind} · {resultText(game)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <details className="card connect">
        <summary>Conectar un bot a este árbitro</summary>
        <pre>{`export ARBITRO_URL=${origin}
export TEAM_TOKEN=<token del equipo>

# crear una práctica contra un bot de la casa
curl -s -X POST "$ARBITRO_URL/api/practice" \\
  -H "Authorization: Bearer $TEAM_TOKEN" -H 'content-type: application/json' \\
  -d '{"opponent":"casa-basico","first":1}'

# o correr el bot del equipo apuntando aquí
ARBITRO_URL=$ARBITRO_URL TEAM_TOKEN=$TEAM_TOKEN npm run bot`}</pre>
        <p className="muted small">
          Contrato: <a href="/api/openapi.json">/api/openapi.json</a> (OpenAPI 1.0.1).
        </p>
      </details>
    </section>
  );
}
