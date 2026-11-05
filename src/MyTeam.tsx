import { useCallback, useEffect, useState } from "react";
import { api, errorText, loadToken, saveToken } from "./api";

type Me = {
  team: { id: string; name: string };
  standing: { position: number; played: number; won: number; drawn: number; lost: number; points: number } | null;
  pending_turns: string[];
  submission: { repo_url: string; commit: string; registered_at: string } | null;
  phase: string;
};

const KEY = "arbitro.team-token";

export default function MyTeam() {
  const [token, setToken] = useState(() => loadToken(KEY));
  const [draft, setDraft] = useState("");
  const [me, setMe] = useState<Me | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [opponent, setOpponent] = useState("casa-basico");
  const [first, setFirst] = useState(1);
  const [repo, setRepo] = useState("");
  const [commit, setCommit] = useState("");

  const refresh = useCallback(async () => {
    if (!token) return;
    const r = await api<Me & { message?: string }>("GET", "/api/me", token);
    if (r.ok) setMe(r.data);
    else {
      setMe(null);
      setMessage({ ok: false, text: errorText(r) });
      if (r.status === 401) {
        setToken("");
        saveToken(KEY, "");
      }
    }
  }, [token]);

  useEffect(() => {
    void refresh();
    if (!token) return;
    const id = setInterval(refresh, 3000);
    return () => clearInterval(id);
  }, [token, refresh]);

  if (!token) {
    return (
      <form
        className="lv-panel lv-form"
        onSubmit={(e) => {
          e.preventDefault();
          const t = draft.trim();
          if (!t) return;
          saveToken(KEY, t);
          setToken(t);
          setDraft("");
          setMessage(null);
        }}
      >
        <h2>Mi equipo</h2>
        <p className="lv-faint">Entra con el token del equipo. Se guarda solo en esta pestaña.</p>
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

  return (
    <div className="lv-myteam">
      <div className="lv-section-head">
        <h2>{me?.team.name ?? "Mi equipo"}</h2>
        <button
          className="lv-link"
          onClick={() => {
            saveToken(KEY, "");
            setToken("");
            setMe(null);
          }}
        >
          Salir
        </button>
      </div>
      {message && <p className={`lv-msg ${message.ok ? "ok" : "error"}`}>{message.text}</p>}

      <div className="lv-grid3">
        <div className="lv-stat">
          <strong>{me?.standing ? `${me.standing.position}.º` : "—"}</strong>
          <span>Posición</span>
        </div>
        <div className="lv-stat">
          <strong>{me?.standing?.points ?? "—"}</strong>
          <span>Puntos</span>
        </div>
        <div className="lv-stat">
          <strong>{me?.pending_turns.length ?? 0}</strong>
          <span>Turnos pendientes</span>
        </div>
      </div>
      {me && !me.standing && <p className="lv-faint lv-small">Equipo de prueba: juega pero no aparece en la tabla.</p>}

      <div className="lv-two">
        <form
          className="lv-panel lv-form"
          onSubmit={async (e) => {
            e.preventDefault();
            const r = await api("POST", "/api/practice", token, { opponent, first });
            setMessage(
              r.ok
                ? { ok: true, text: `Práctica ${String(r.data.game_id)} creada: tu bot la recibe en /api/next.` }
                : { ok: false, text: errorText(r) },
            );
            void refresh();
          }}
        >
          <h3>Práctica</h3>
          <label>
            Rival
            <select value={opponent} onChange={(e) => setOpponent(e.target.value)}>
              <option value="casa-basico">casa-basico (gana y bloquea)</option>
              <option value="casa-aleatorio">casa-aleatorio (al azar)</option>
            </select>
          </label>
          <label>
            Abre
            <select value={first} onChange={(e) => setFirst(Number(e.target.value))}>
              <option value={1}>Mi bot</option>
              <option value={2}>La casa</option>
            </select>
          </label>
          <button className="lv-btn" type="submit" disabled={me?.phase !== "practice"}>
            Crear práctica
          </button>
          {me && me.phase !== "practice" && <p className="lv-faint lv-small">Las prácticas cerraron.</p>}
        </form>

        <form
          className="lv-panel lv-form"
          onSubmit={async (e) => {
            e.preventDefault();
            const r = await api("PUT", "/api/me/submission", token, { repo_url: repo.trim(), commit: commit.trim() });
            setMessage(r.ok ? { ok: true, text: "Entrega registrada." } : { ok: false, text: errorText(r) });
            void refresh();
          }}
        >
          <h3>Entrega</h3>
          {me?.submission ? (
            <p className="lv-small">
              Registrada: <span className="lv-mono">{me.submission.commit}</span> ·{" "}
              {new Date(me.submission.registered_at).toLocaleTimeString("es-GT", { hour12: false })}
              <br />
              <span className="lv-faint">{me.submission.repo_url}</span>
            </p>
          ) : (
            <p className="lv-faint lv-small">Sin entrega registrada.</p>
          )}
          <label>
            URL del repositorio
            <input value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="https://github.com/…" />
          </label>
          <label>
            Hash del commit
            <input value={commit} onChange={(e) => setCommit(e.target.value)} placeholder="a1b2c3d" className="lv-mono" />
          </label>
          <button className="lv-btn" type="submit" disabled={me?.phase !== "practice"}>
            Registrar entrega
          </button>
        </form>
      </div>
    </div>
  );
}
