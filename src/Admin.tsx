import { useEffect, useState } from "react";
import { api, errorText, loadToken, saveToken } from "./api";

const KEY = "arbitro.admin-token";
const PHASES = ["practice", "frozen", "league", "playoffs", "finished"];
const HOUSE = ["casa-basico", "casa-aleatorio"];

export default function Admin() {
  const [token, setToken] = useState(() => loadToken(KEY));
  const [draft, setDraft] = useState("");
  const [teams, setTeams] = useState<{ id: string; name: string }[]>([]);
  const [p1, setP1] = useState("");
  const [p2, setP2] = useState("");
  const [kind, setKind] = useState("friendly");
  const [phase, setPhase] = useState("practice");
  const [text, setText] = useState("");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    fetch("/api/state")
      .then((r) => r.json())
      .then((s: { teams: { id: string; name: string }[]; phase: string }) => {
        setTeams(s.teams);
        setPhase(s.phase);
        setP1(s.teams[0]?.id ?? "");
        setP2(s.teams[1]?.id ?? HOUSE[0]);
      })
      .catch(() => undefined);
  }, []);

  async function run(action: string, body: unknown, success: string) {
    const r = await api("POST", `/api/admin/${action}`, token, body);
    setMessage(r.ok ? { ok: true, text: success.replace("{id}", String(r.data.game_id ?? "")) } : { ok: false, text: errorText(r) });
    if (r.status === 401) {
      saveToken(KEY, "");
      setToken("");
    }
  }

  if (!token) {
    return (
      <form
        className="lv-panel lv-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (!draft.trim()) return;
          saveToken(KEY, draft.trim());
          setToken(draft.trim());
          setDraft("");
        }}
      >
        <h2>Admin</h2>
        <p className="lv-faint">
          Token de administración (<span className="lv-mono">ARBITRO_ADMIN_TOKEN</span>; en local es{" "}
          <span className="lv-mono">admin-local</span>).
        </p>
        {message && <p className="lv-msg error">{message.text}</p>}
        <label>
          Token
          <input type="password" value={draft} onChange={(e) => setDraft(e.target.value)} autoComplete="off" />
        </label>
        <button className="lv-btn" type="submit">
          Entrar
        </button>
      </form>
    );
  }

  const options = [...teams.map((t) => ({ id: t.id, label: t.name })), ...HOUSE.map((h) => ({ id: h, label: h }))];

  return (
    <div className="lv-myteam">
      <div className="lv-section-head">
        <h2>Admin</h2>
        <button
          className="lv-link"
          onClick={() => {
            saveToken(KEY, "");
            setToken("");
          }}
        >
          Salir
        </button>
      </div>
      {message && <p className={`lv-msg ${message.ok ? "ok" : "error"}`}>{message.text}</p>}

      <div className="lv-two">
        <form
          className="lv-panel lv-form"
          onSubmit={(e) => {
            e.preventDefault();
            void run("games", { kind, player1: p1, player2: p2 }, "Partida {id} creada.");
          }}
        >
          <h3>Partida suelta</h3>
          <label>
            Tipo
            <select value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="friendly">Amistoso</option>
              <option value="league">Liga</option>
            </select>
          </label>
          <label>
            Abre (jugador 1)
            <select value={p1} onChange={(e) => setP1(e.target.value)}>
              {options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Responde (jugador 2)
            <select value={p2} onChange={(e) => setP2(e.target.value)}>
              {options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <button className="lv-btn" type="submit">
            Crear partida
          </button>
        </form>

        <div className="lv-panel lv-form">
          <h3>Torneo</h3>
          <p className="lv-faint lv-small">
            Liga: todos contra todos, ida y vuelta; cada equipo juega una partida a la vez. Playoffs: final y tercer
            puesto al mejor de tres, según la tabla.
          </p>
          <button className="lv-btn" onClick={() => void run("league", {}, "Liga programada.")}>
            Iniciar liga
          </button>
          <button className="lv-btn" onClick={() => void run("playoffs", {}, "Playoffs programados.")}>
            Iniciar playoffs
          </button>
          <label>
            Fase
            <select value={phase} onChange={(e) => setPhase(e.target.value)}>
              {PHASES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
          <button className="lv-btn secondary" onClick={() => void run("phase", { phase }, `Fase: ${phase}.`)}>
            Cambiar fase
          </button>
          <label>
            Anuncio
            <input value={text} onChange={(e) => setText(e.target.value)} maxLength={280} />
          </label>
          <button className="lv-btn secondary" onClick={() => void run("announcement", { text }, "Anuncio actualizado.")}>
            Publicar anuncio
          </button>
          <button
            className="lv-btn danger"
            onClick={() => {
              if (window.confirm("¿Borrar todas las partidas, entregas y la tabla?")) void run("reset", {}, "Árbitro reiniciado.");
            }}
          >
            Reiniciar árbitro
          </button>
        </div>
      </div>
    </div>
  );
}
