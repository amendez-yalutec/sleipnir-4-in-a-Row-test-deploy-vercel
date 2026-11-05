/**
 * Tabla de posiciones: solo partidas de liga terminadas. Victoria 3, empate 1, derrota 0.
 * Desempates del árbitro: puntos, enfrentamiento directo, diferencia V−D y sorteo
 * (aquí un sorteo determinista por id, para que la tabla no cambie entre recargas).
 */
import type { Game, TeamInfo } from "./types.js";

export interface StandingRow {
  position: number;
  team: { id: string; name: string; members: string[] };
  played: number;
  won: number;
  drawn: number;
  lost: number;
  points: number;
}

function draw(id: string): number {
  let h = 2166136261;
  for (const ch of id) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}

const teamIdAt = (game: Game, p: 1 | 2) => {
  const seat = game.seats[p];
  return seat.type === "team" ? seat.id : null;
};

export function computeStandings(teams: TeamInfo[], games: Game[]): StandingRow[] {
  const league = games.filter((g) => g.kind === "league" && g.result);
  const rows = new Map(
    teams.filter((t) => !t.test).map((t) => [
      t.id,
      { team: { id: t.id, name: t.name, members: [...t.members] }, played: 0, won: 0, drawn: 0, lost: 0, points: 0 },
    ]),
  );

  for (const game of league) {
    for (const p of [1, 2] as const) {
      const row = rows.get(teamIdAt(game, p) ?? "");
      if (!row) continue;
      row.played++;
      if (game.result!.winner === null) {
        row.drawn++;
        row.points += 1;
      } else if (game.result!.winner === p) {
        row.won++;
        row.points += 3;
      } else row.lost++;
    }
  }

  /** Puntos obtenidos solo en partidas entre los equipos empatados. */
  const headToHead = (group: Set<string>) => {
    const pts = new Map<string, number>();
    for (const game of league) {
      const a = teamIdAt(game, 1);
      const b = teamIdAt(game, 2);
      if (!a || !b || !group.has(a) || !group.has(b)) continue;
      const w = game.result!.winner;
      pts.set(a, (pts.get(a) ?? 0) + (w === null ? 1 : w === 1 ? 3 : 0));
      pts.set(b, (pts.get(b) ?? 0) + (w === null ? 1 : w === 2 ? 3 : 0));
    }
    return pts;
  };

  const all = [...rows.values()];
  const h2h = new Map<string, number>();
  for (const points of new Set(all.map((r) => r.points))) {
    const tied = all.filter((r) => r.points === points);
    if (tied.length < 2) continue;
    for (const [id, p] of headToHead(new Set(tied.map((r) => r.team.id)))) h2h.set(id, p);
  }

  return all
    .sort(
      (a, b) =>
        b.points - a.points ||
        (h2h.get(b.team.id) ?? 0) - (h2h.get(a.team.id) ?? 0) ||
        b.won - b.lost - (a.won - a.lost) ||
        draw(a.team.id) - draw(b.team.id),
    )
    .map((row, i) => ({ position: i + 1, ...row }));
}
