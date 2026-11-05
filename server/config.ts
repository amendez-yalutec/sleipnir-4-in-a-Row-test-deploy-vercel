/** Configuración del árbitro desde variables de entorno (todas opcionales). */
import type { TeamInfo } from "./types.js";

export interface ArbiterConfig {
  teams: TeamInfo[];
  /** null = rutas /api/admin desactivadas. */
  adminToken: string | null;
  deadlineMs: number;
  absenceMs: number;
  onVercel: boolean;
}

/** Tokens de juguete para probar. Para un árbitro con tokens propios, define ARBITRO_TEAMS. */
const DEFAULT_TEAMS: TeamInfo[] = [
  { id: "eq6", name: "Equipo 6", token: "token-local-eq6", members: [] },
  { id: "rival", name: "Rival local", token: "token-local-rival", members: [] },
];

type Env = Record<string, string | undefined>;

function number(env: Env, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) throw new Error(`${name} debe ser un número ≥ 0 (recibido "${raw}").`);
  return value;
}

/**
 * `ARBITRO_TEAMS="id:token:Nombre;id2:token2:Nombre 2"` (mismo formato que MOCK_TEAMS del mock del equipo).
 * Un `~` antes del id marca un equipo de prueba: `~prueba1:tok:Prueba 1`.
 */
function parseTeams(raw: string | undefined): TeamInfo[] {
  if (raw === undefined || raw.trim() === "") return DEFAULT_TEAMS;
  return raw
    .split(";")
    .filter((entry) => entry.trim() !== "")
    .map((entry) => {
      const [rawId = "", rawToken = "", ...rest] = entry.split(":");
      const test = rawId.trim().startsWith("~");
      const [id, token, name] = [rawId.trim().replace(/^~/, ""), rawToken.trim(), rest.join(":").trim()];
      if (!id || !token || !name) throw new Error(`ARBITRO_TEAMS: "${entry}" no tiene la forma id:token:Nombre.`);
      return { id, token, name, members: [], ...(test && { test: true }) };
    });
}

export function loadConfig(env: Env = process.env): ArbiterConfig {
  const onVercel = Boolean(env.VERCEL);
  const admin = env.ARBITRO_ADMIN_TOKEN?.trim();
  return {
    teams: parseTeams(env.ARBITRO_TEAMS),
    // En local hay token de admin por defecto; en Vercel solo si se configura.
    adminToken: admin ? admin : onVercel ? null : "admin-local",
    deadlineMs: number(env, "ARBITRO_DEADLINE_MS", 3_000),
    absenceMs: number(env, "ARBITRO_ABSENCE_MS", 30_000),
    onVercel,
  };
}
