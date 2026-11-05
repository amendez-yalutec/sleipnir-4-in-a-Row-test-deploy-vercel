/**
 * Rutas HTTP del árbitro con Request/Response estándar: sirven igual en una función de Vercel
 * (api/index.ts) que en el servidor local (server/dev.ts).
 */
import {
  type Ctx,
  adminForfeit,
  createGame,
  createPractice,
  findTurn,
  needsTick,
  pendingTurns,
  scheduleLeague,
  schedulePlayoffs,
  submissionsOpen,
  submitMove,
  tick,
} from "./arbiter.js";
import { type ArbiterConfig, loadConfig } from "./config.js";
import { gameJson, gameSummary, namesFrom, stateSnapshot, turnJson } from "./json.js";
import { SPEC } from "./openapi.js";
import type { Player } from "./rules.js";
import { computeStandings } from "./standings.js";
import { type Store, storeFromEnv } from "./store.js";
import {
  GAME_KINDS,
  type GameKind,
  PHASES,
  type Phase,
  type ArbiterState,
  type Reply,
  type Seat,
  type TeamInfo,
  errorReply,
  initialState,
  isHouseBot,
} from "./types.js";

const MAX_WAIT_S = 25;
const DEFAULT_WAIT_S = 20;
const LIVE_PING_MS = 15_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, PUT, OPTIONS",
  "access-control-allow-headers": "authorization, content-type",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...CORS },
  });
}

const reply = (r: Reply) => json(r.body, r.status);

/** Comparación que no filtra por tiempo cuántos caracteres coinciden. */
function safeEqual(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

function bearer(request: Request): string | null {
  const header = request.headers.get("authorization") ?? "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() : null;
}

type Body = { ok: true; value: Record<string, unknown> } | { ok: false };

async function readBody(request: Request): Promise<Body> {
  try {
    const value: unknown = JSON.parse(await request.text());
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? { ok: true, value: value as Record<string, unknown> }
      : { ok: false };
  } catch {
    return { ok: false };
  }
}

const invalidJson = errorReply(400, "validation", "JSON inválido.");

/** Ruta real: Vercel puede entregar la reescritura como /api/index?__path=… */
function routeOf(request: Request): { path: string; query: URLSearchParams; origin: string } {
  const url = new URL(request.url);
  const query = new URLSearchParams(url.search);
  let path = url.pathname;
  const rewritten = query.get("__path");
  if (rewritten !== null) {
    path = `/api/${rewritten}`;
    query.delete("__path");
  }
  const host = request.headers.get("x-forwarded-host") ?? url.host;
  const proto = request.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  return { path: path.replace(/\/+$/, "") || "/", query, origin: `${proto}://${host}` };
}

export interface HandlerOptions {
  store?: Store;
  config?: ArbiterConfig;
  /** Tiempo máximo de una conexión /api/live antes de cerrarla (EventSource reconecta solo). */
  liveMaxMs?: number;
}

export function createHandler(options: HandlerOptions = {}) {
  const store = options.store ?? storeFromEnv();
  const config = options.config ?? loadConfig();
  const liveMaxMs = options.liveMaxMs ?? (config.onVercel ? 50_000 : Infinity);
  const names = namesFrom(config.teams);
  const ctx = (): Ctx => ({ now: Date.now(), deadlineMs: config.deadlineMs, absenceMs: config.absenceMs });

  const teamOf = (request: Request): TeamInfo | undefined => {
    const token = bearer(request);
    return token ? config.teams.find((t) => safeEqual(t.token, token)) : undefined;
  };
  const isAdmin = (request: Request) => {
    const token = bearer(request);
    return config.adminToken !== null && token !== null && safeEqual(config.adminToken, token);
  };

  /** Escritura con exclusión mutua; antes y después corre el mantenimiento del torneo. */
  const write = <T,>(fn: (s: ArbiterState) => T) =>
    store.update((s) => {
      tick(s, ctx());
      const result = fn(s);
      tick(s, ctx());
      return result;
    });

  /** Estado con ausencias, plazos y partidas programadas ya aplicados. */
  async function fresh() {
    const state = await store.read();
    if (!needsTick(state, ctx())) return state;
    return write((s) => s);
  }

  const extras = () => ({
    rules: { deadline_ms: config.deadlineMs, absence_ms: config.absenceMs },
    storage: store.kind,
    shared_state: store.kind === "redis" || !config.onVercel,
  });

  // ── Bot ─────────────────────────────────────────────────────────────────────────────────────

  async function next(request: Request, team: TeamInfo, query: URLSearchParams): Promise<Response> {
    const raw = query.get("wait");
    if (raw !== null && !/^\d{1,2}$/.test(raw)) return reply(errorReply(400, "validation", "wait debe ser un entero de 0 a 25."));
    const wait = raw === null ? DEFAULT_WAIT_S : Number(raw);
    if (wait > MAX_WAIT_S) return reply(errorReply(400, "validation", "wait debe ser un entero de 0 a 25."));

    const until = Date.now() + wait * 1000;
    for (;;) {
      const state = await store.read();
      if (needsTick(state, ctx()) || findTurn(state, team.id)) {
        const turn = await write((s) => {
          const found = findTurn(s, team.id);
          if (!found) return null;
          // El reloj arranca la primera vez que se entrega el turno; pedirlo otra vez no lo reinicia.
          found.game.pending!.servedAt ??= Date.now();
          return turnJson(found.game, found.seat, config.deadlineMs, names);
        });
        if (turn) return json(turn);
      }
      const left = until - Date.now();
      if (left <= 0 || request.signal.aborted) return json({ status: "idle" });
      await sleep(Math.min(store.pollMs, left));
    }
  }

  async function move(request: Request, team: TeamInfo): Promise<Response> {
    const body = await readBody(request);
    if (!body.ok) return reply(invalidJson);
    const { game_id, column } = body.value;
    if (typeof game_id !== "string" || game_id === "") return reply(errorReply(400, "validation", "game_id es obligatorio."));
    // Un entero fuera de 0–7 es jugada ilegal y pierde (bases: "columna llena o fuera de rango");
    // lo que no es entero es un cuerpo inválido y no penaliza.
    if (!Number.isInteger(column)) return reply(errorReply(400, "validation", "column debe ser un entero de 0 a 7."));
    return reply(await write((s) => submitMove(s, team, game_id, column as number, ctx())));
  }

  async function practice(request: Request, team: TeamInfo): Promise<Response> {
    const body = await readBody(request);
    if (!body.ok) return reply(invalidJson);
    const { opponent = "casa-basico", first = 1 } = body.value;
    if (!isHouseBot(opponent)) return reply(errorReply(400, "validation", `Rival inválido: ${String(opponent)}.`));
    if (first !== 1 && first !== 2) return reply(errorReply(400, "validation", "first debe ser 1 o 2."));
    return reply(await write((s) => createPractice(s, team, opponent, first as Player, Date.now())));
  }

  // ── Equipo ──────────────────────────────────────────────────────────────────────────────────

  async function me(team: TeamInfo): Promise<Response> {
    const state = await fresh();
    const row = computeStandings(config.teams, state.games).find((r) => r.team.id === team.id);
    return json({
      team: { id: team.id, name: team.name, members: team.members },
      standing: row
        ? { position: row.position, played: row.played, won: row.won, drawn: row.drawn, lost: row.lost, points: row.points }
        : null,
      pending_turns: pendingTurns(state, team.id),
      submission: state.submissions[team.id] ?? null,
      phase: state.phase,
    });
  }

  async function submission(request: Request, team: TeamInfo): Promise<Response> {
    const body = await readBody(request);
    if (!body.ok) return reply(invalidJson);
    const { repo_url, commit } = body.value;
    if (typeof repo_url !== "string" || !/^https?:\/\/(github\.com|bitbucket\.org)\/.+/.test(repo_url)) {
      return reply(errorReply(400, "validation", "repo_url debe ser un repositorio de github.com o bitbucket.org."));
    }
    if (typeof commit !== "string" || !/^[0-9a-fA-F]{7,40}$/.test(commit)) {
      return reply(errorReply(400, "validation", "commit debe ser un hash hexadecimal de 7 a 40 caracteres."));
    }
    return reply(
      await write((s) => {
        if (!submissionsOpen(s)) return errorReply(423, "submissions_closed", "Las entregas están cerradas.");
        const record = { repo_url, commit, registered_at: new Date().toISOString() };
        s.submissions[team.id] = record;
        return { status: 200, body: record };
      }),
    );
  }

  // ── Público ─────────────────────────────────────────────────────────────────────────────────

  async function listGames(query: URLSearchParams): Promise<Response> {
    const kind = query.get("kind");
    const limitRaw = query.get("limit") ?? "50";
    if (kind !== null && !(GAME_KINDS as readonly string[]).includes(kind)) {
      return reply(errorReply(400, "validation", "kind o limit inválidos."));
    }
    const limit = /^\d{1,3}$/.test(limitRaw) ? Number(limitRaw) : NaN;
    if (!(limit >= 1 && limit <= 500)) return reply(errorReply(400, "validation", "kind o limit inválidos."));
    const state = await fresh();
    return json(
      [...state.games]
        .reverse()
        .filter((g) => kind === null || g.kind === kind)
        .slice(0, limit)
        .map((g) => gameSummary(g, names)),
    );
  }

  async function getGame(id: string): Promise<Response> {
    const state = await fresh();
    const game = state.games.find((g) => g.id === id);
    return game ? json(gameJson(game, names)) : reply(errorReply(404, "unknown_game", "No existe."));
  }

  function live(request: Request): Response {
    const encoder = new TextEncoder();
    let stopped = false;
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (text: string) => controller.enqueue(encoder.encode(text));
        const end = Date.now() + liveMaxMs;
        let last = "";
        let lastPing = Date.now();
        try {
          send("retry: 1000\n\n");
          while (!stopped && !request.signal.aborted && Date.now() < end) {
            const snapshot = JSON.stringify(stateSnapshot(await fresh(), config.teams, extras()));
            if (snapshot !== last) {
              send(`event: state\ndata: ${snapshot}\n\n`);
              last = snapshot;
            }
            if (Date.now() - lastPing >= LIVE_PING_MS) {
              send(": ping\n\n");
              lastPing = Date.now();
            }
            await sleep(Math.max(150, store.pollMs * 2.5));
          }
        } catch {
          // El cliente cerró o falló el almacenamiento: EventSource reconecta.
        }
        try {
          controller.close();
        } catch {
          /* ya cerrado */
        }
      },
      cancel() {
        stopped = true;
      },
    });
    return new Response(stream, {
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "x-accel-buffering": "no",
        ...CORS,
      },
    });
  }

  // ── Admin (no está en el OpenAPI: sirve para preparar pruebas) ──────────────────────────────

  function seatFrom(value: unknown): Seat | null {
    if (isHouseBot(value)) return { type: "house", bot: value };
    return typeof value === "string" && config.teams.some((t) => t.id === value) ? { type: "team", id: value } : null;
  }

  async function admin(request: Request, action: string): Promise<Response> {
    const body = await readBody(request);
    if (!body.ok) return reply(invalidJson);
    const v = body.value;
    switch (action) {
      case "games": {
        const kind = (v.kind ?? "friendly") as GameKind;
        const p1 = seatFrom(v.player1);
        const p2 = seatFrom(v.player2);
        if (!(GAME_KINDS as readonly string[]).includes(kind) || kind === "practice") {
          return reply(errorReply(400, "validation", "kind debe ser friendly, league, third_place o final."));
        }
        if (!p1 || !p2) return reply(errorReply(400, "validation", "player1 y player2 deben ser ids de equipo o bots de la casa."));
        if (p1.type === "team" && p2.type === "team" && p1.id === p2.id) {
          return reply(errorReply(400, "validation", "Un equipo no puede jugar contra sí mismo."));
        }
        const game = await write((s) => createGame(s, kind, p1, p2, Date.now()));
        return json({ game_id: game.id }, 201);
      }
      case "phase": {
        if (!(PHASES as readonly string[]).includes(v.phase as string)) {
          return reply(errorReply(400, "validation", `phase debe ser una de: ${PHASES.join(", ")}.`));
        }
        await store.update((s) => void (s.phase = v.phase as Phase));
        return json({ ok: true, phase: v.phase });
      }
      case "announcement": {
        const text = typeof v.text === "string" && v.text.trim() ? v.text.trim().slice(0, 280) : null;
        await store.update((s) => void (s.announcement = text));
        return json({ ok: true, announcement: text });
      }
      case "forfeit": {
        if (typeof v.game_id !== "string" || (v.loser !== 1 && v.loser !== 2)) {
          return reply(errorReply(400, "validation", "game_id y loser (1 o 2) son obligatorios."));
        }
        return reply(await write((s) => adminForfeit(s, v.game_id as string, v.loser as Player, Date.now())));
      }
      case "league":
        return reply(await write((s) => scheduleLeague(s, config.teams, Date.now())));
      case "playoffs":
        return reply(
          await write((s) => {
            const unfinished = s.games.some((g) => g.kind === "league" && !g.result);
            if (unfinished) return errorReply(409, "validation", "La liga todavía tiene partidas pendientes.");
            const ranking = computeStandings(config.teams, s.games).map((r) => r.team.id);
            return schedulePlayoffs(s, ranking, Date.now());
          }),
        );
      case "reset": {
        await store.update((s) => void Object.assign(s, initialState()));
        return json({ ok: true });
      }
      default:
        return reply(errorReply(404, "not_found", "Ruta no encontrada."));
    }
  }

  // ── Enrutador ───────────────────────────────────────────────────────────────────────────────

  return async function handle(request: Request): Promise<Response> {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    const { path, query, origin } = routeOf(request);
    const method = request.method;
    const route = `${method} ${path}`;

    try {
      // Público
      if (route === "GET /api/health") return json({ ok: true, phase: (await store.read()).phase, time: new Date().toISOString() });
      if (route === "GET /api/openapi.json") return json({ ...SPEC, servers: [{ url: origin, description: "Árbitro de prueba" }] });
      if (route === "GET /api/standings") {
        const state = await fresh();
        return json({ phase: state.phase, standings: computeStandings(config.teams, state.games) });
      }
      if (route === "GET /api/games") return await listGames(query);
      if (method === "GET" && path.startsWith("/api/games/")) return await getGame(decodeURIComponent(path.slice(11)));
      if (route === "GET /api/state") return json(stateSnapshot(await fresh(), config.teams, extras()));
      if (route === "GET /api/live") return live(request);

      // Admin
      if (method === "POST" && path.startsWith("/api/admin/")) {
        if (!isAdmin(request)) return reply(errorReply(401, "unauthorized", "Token de administración inválido."));
        return await admin(request, path.slice(11));
      }

      // Bot y Equipo
      const authed = ["GET /api/next", "POST /api/move", "POST /api/practice", "GET /api/me", "PUT /api/me/submission"];
      if (!authed.includes(route)) return reply(errorReply(404, "not_found", "Ruta no encontrada."));
      const team = teamOf(request);
      if (!team) return reply(errorReply(401, "unauthorized", "Token inválido."));
      if (route === "GET /api/next") return await next(request, team, query);
      if (route === "POST /api/move") return await move(request, team);
      if (route === "POST /api/practice") return await practice(request, team);
      if (route === "GET /api/me") return await me(team);
      return await submission(request, team);
    } catch (error) {
      console.error("[arbitro]", route, error);
      return reply(errorReply(500, "internal", "Error interno del árbitro."));
    }
  };
}
