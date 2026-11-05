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
  teams: { id: string; name: string; test?: true }[];
  standings: Standing[];
  live: Game[];
  scheduled: number;
  recent: GameSummary[];
  series: { series: "third" | "final"; players: PlayerRef[]; wins: [number, number]; winner: PlayerRef | null }[];
};

const PHASES: Record<string, string> = {
  practice: "Práctica",
  frozen: "Congelado",
  league: "Liga",
  playoffs: "Playoffs",
  finished: "Terminado",
};
const KINDS: Record<string, string> = {
  practice: "Práctica",
  friendly: "Amistoso",
  league: "Liga",
  third_place: "Tercer lugar",
  final: "Final",
};
const REASONS: Record<string, string> = {
  connect4: "por cuatro en línea",
  illegal_move: "por jugada ilegal",
  timeout: "por tiempo",
  absent: "por ausencia",
  admin: "por decisión del árbitro",
};

const timeOf = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString("es-GT", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }) : "";

/** Fila de la última ficha jugada (la más alta ocupada en esa columna). */
function lastCell(game: Game): [number, number] | null {
  const last = game.moves.at(-1);
  if (!last) return null;
  for (let r = game.board.length - 1; r >= 0; r--) if (game.board[r][last.column] !== 0) return [r, last.column];
  return null;
}

function Board({ game }: { game: Game }) {
  const last = lastCell(game);
  const winning = game.result?.winning_cells ?? [];
  const rows = game.board.length;
  return (
    <div className="lv-board" role="img" aria-label={`Tablero de la partida ${game.game_id}`}>
      {[...game.board].reverse().map((row, i) => {
        const r = rows - 1 - i; // fila 0 abajo
        return row.map((cell, c) => {
          const cls = [
            "lv-cell",
            cell ? `p${cell}` : "",
            last && last[0] === r && last[1] === c ? "last" : "",
            winning.some(([wr, wc]) => wr === r && wc === c) ? "win" : "",
          ].join(" ");
          return <span key={`${r}-${c}`} className={cls} />;
        });
      })}
    </div>
  );
}

function PlayerTag({ game, p }: { game: GameSummary; p: "1" | "2" }) {
  const toMove = game.current === Number(p);
  const won = game.result?.winner === Number(p);
  return (
    <span className={`lv-player p${p} ${toMove ? "to-move" : ""} ${won ? "won" : ""}`}>
      <span className="dot" />
      {game.players[p].name}
    </span>
  );
}

function resultText(game: GameSummary): string {
  const r = game.result;
  if (!r) return "En curso";
  if (r.winner === null) return "Empate";
  let detail = REASONS[r.reason] ?? r.reason;
  if (r.reason === "timeout" && r.ms !== undefined) detail += ` (${r.ms} ms)`;
  if (r.reason === "absent" && r.waited_ms !== undefined) detail += ` (${Math.round(r.waited_ms / 1000)} s)`;
  if (r.reason === "illegal_move" && r.column !== undefined) detail += ` (columna ${String(r.column)})`;
  return `Gana ${game.players[String(r.winner) as "1" | "2"].name} ${detail}`;
}

function GameCard({ game }: { game: Game }) {
  return (
    <article className="lv-card">
      <div className="lv-card-head">
        <span className="lv-kind">{KINDS[game.kind] ?? game.kind}</span>
        <span className="lv-faint">{game.result ? game.game_id : `jugada ${game.moves.length + 1}`}</span>
      </div>
      <Board game={game} />
      <div className="lv-card-foot">
        <PlayerTag game={game} p="1" />
        <PlayerTag game={game} p="2" />
      </div>
    </article>
  );
}

function Replay({ id, onClose }: { id: string; onClose: () => void }) {
  const [game, setGame] = useState<Game | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    setGame(null);
    setError(false);
    fetch(`/api/games/${encodeURIComponent(id)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setGame)
      .catch(() => setError(true));
  }, [id]);
  return (
    <div className="lv-replay">
      <div className="lv-section-head">
        <h3>Partida {id}</h3>
        <button className="lv-link" onClick={onClose}>
          Cerrar
        </button>
      </div>
      {error && <p className="lv-empty">No se pudo cargar la partida.</p>}
      {game && (
        <div className="lv-replay-body">
          <GameCard game={game} />
          <div className="lv-replay-info">
            <p>
              <strong>{resultText(game)}</strong>
            </p>
            <p className="lv-faint">
              {game.moves.length} jugadas · {timeOf(game.started_at)} – {timeOf(game.finished_at)}
            </p>
            <p className="lv-faint">Columnas (1–8): {game.moves.map((m) => m.column + 1).join(" ")}</p>
          </div>
        </div>
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
  const leagueTeams = snap?.teams.filter((t) => !t.test).length ?? 0;

  return (
    <section className="lv">
      <div className="lv-hero">
        <div>
          <p className="lv-eyebrow">
            {snap ? (PHASES[snap.phase] ?? snap.phase) : "…"}
            <span className={`lv-status ${connected ? "on" : ""}`} title={connected ? "Conectado" : "Reconectando"} />
          </p>
          <h1 className="lv-title">Tablero en vivo</h1>
        </div>
        <div className="lv-stats">
          <div className="lv-stat">
            <strong>{leagueTeams}</strong>
            <span>Equipos</span>
          </div>
          <div className="lv-stat">
            <strong>{snap?.live.length ?? 0}</strong>
            <span>En juego</span>
          </div>
          {!!snap?.scheduled && (
            <div className="lv-stat">
              <strong>{snap.scheduled}</strong>
              <span>Programadas</span>
            </div>
          )}
        </div>
      </div>

      {snap && !snap.shared_state && (
        <p className="lv-warn">
          Este árbitro guarda el estado en memoria y en Vercel cada instancia tiene el suyo. Conecta Upstash Redis
          (Vercel → Storage) para que todas las rutas vean las mismas partidas.
        </p>
      )}
      {snap?.announcement && <p className="lv-announce">{snap.announcement}</p>}

      {replay && <Replay id={replay} onClose={() => setReplay(null)} />}

      {!!snap?.series.length && (
        <>
          <div className="lv-section-head">
            <h2>Playoffs</h2>
            <span className="lv-faint">al mejor de tres</span>
          </div>
          <div className="lv-series">
            {snap.series.map((s) => (
              <div key={s.series} className="lv-panel">
                <span className="lv-kind">{s.series === "final" ? "Final" : "Tercer puesto"}</span>
                <div className="lv-series-score">
                  <span className={s.winner?.team_id === s.players[0].team_id ? "won" : ""}>{s.players[0].name}</span>
                  <strong>
                    {s.wins[0]} – {s.wins[1]}
                  </strong>
                  <span className={s.winner?.team_id === s.players[1].team_id ? "won" : ""}>{s.players[1].name}</span>
                </div>
                <span className="lv-faint lv-small">{s.winner ? `Gana ${s.winner.name}` : "En curso"}</span>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="lv-section-head">
        <h2>En juego</h2>
        {snap && (
          <span className="lv-faint">
            {snap.rules.deadline_ms / 1000} s por jugada · {snap.rules.absence_ms / 1000} s de ausencia
          </span>
        )}
      </div>
      {snap && snap.live.length === 0 ? (
        <p className="lv-empty">Ninguna partida en curso.</p>
      ) : (
        <div className="lv-games">{snap?.live.map((game) => <GameCard key={game.game_id} game={game} />)}</div>
      )}

      <div className="lv-two">
        <div>
          <div className="lv-section-head">
            <h2>Posiciones</h2>
            <span className="lv-faint lv-spaced">V 3 · E 1 · D 0</span>
          </div>
          <table className="lv-table">
            <thead>
              <tr>
                <th>#</th>
                <th className="left">Equipo</th>
                <th title="Jugadas">PJ</th>
                <th title="Victorias">V</th>
                <th title="Empates">E</th>
                <th title="Derrotas">D</th>
                <th className="right" title="Puntos">
                  Pts
                </th>
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
                  <td className="right">
                    <strong>{row.points}</strong>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="lv-faint lv-small">Desempates: puntos, enfrentamiento directo, diferencia V−D, sorteo.</p>
        </div>

        <div>
          <div className="lv-section-head">
            <h2>Últimos resultados</h2>
          </div>
          {snap && snap.recent.length === 0 ? (
            <p className="lv-empty">Todavía no hay resultados.</p>
          ) : (
            <ul className="lv-results">
              {snap?.recent.map((game) => (
                <li key={game.game_id}>
                  <button className="lv-result" onClick={() => setReplay(game.game_id)}>
                    <span className="lv-kind">{KINDS[game.kind] ?? game.kind}</span>
                    <span className="lv-vs">
                      <PlayerTag game={game} p="1" />
                      <span className="lv-faint">vs</span>
                      <PlayerTag game={game} p="2" />
                    </span>
                    <span className="lv-faint lv-small">
                      {resultText(game)} · {timeOf(game.finished_at)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <details className="lv-connect">
        <summary>Conectar un bot a este árbitro</summary>
        <pre>{`export ARBITRO_URL=${origin}
export TEAM_TOKEN=<token del equipo>

# crear una práctica contra un bot de la casa
curl -s -X POST "$ARBITRO_URL/api/practice" \\
  -H "Authorization: Bearer $TEAM_TOKEN" -H 'content-type: application/json' \\
  -d '{"opponent":"casa-basico","first":1}'

# o correr el bot del equipo apuntando aquí
ARBITRO_URL=$ARBITRO_URL TEAM_TOKEN=$TEAM_TOKEN npm run bot`}</pre>
        <p className="lv-faint lv-small">
          Contrato: <a href="/api/openapi.json">/api/openapi.json</a> (OpenAPI 1.0.1).
        </p>
      </details>
    </section>
  );
}
