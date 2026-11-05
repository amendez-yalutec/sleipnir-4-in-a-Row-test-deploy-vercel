/**
 * Prueba de humo contra un árbitro (local o desplegado): crea prácticas y las juega con una
 * estrategia simple, usando solo /api/practice, /api/next y /api/move como lo haría un bot.
 *
 *   ARBITRO_URL=http://127.0.0.1:8787 TEAM_TOKEN=token-local-eq6 npm run smoke
 *   ARBITRO_URL=https://tu-proyecto.vercel.app TEAM_TOKEN=token-local-eq6 GAMES=2 npm run smoke
 */
const base = (process.env.ARBITRO_URL ?? "http://127.0.0.1:8787").replace(/\/+$/, "");
const token = process.env.TEAM_TOKEN ?? "token-local-eq6";
const games = Number(process.env.GAMES ?? 2);
const auth = { authorization: `Bearer ${token}`, "content-type": "application/json" };

async function call(method: string, path: string, body?: unknown) {
  const started = Date.now();
  const res = await fetch(`${base}${path}`, { method, headers: auth, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = (await res.json()) as Record<string, any>;
  return { status: res.status, data, ms: Date.now() - started };
}

function pick(legal: number[]): number {
  // Centro primero: suficiente para una prueba de humo.
  return [...legal].sort((a, b) => Math.abs(a - 3.5) - Math.abs(b - 3.5))[0];
}

const health = await call("GET", "/api/health");
console.log(`health → ${health.status}`, health.data);
if (health.status !== 200) process.exit(1);

let failures = 0;
for (let i = 0; i < games; i++) {
  const opponent = i % 2 === 0 ? "casa-aleatorio" : "casa-basico";
  const first = i % 2 === 0 ? 1 : 2;
  const created = await call("POST", "/api/practice", { opponent, first });
  if (created.status !== 201) {
    console.error("No se pudo crear la práctica:", created.status, created.data);
    process.exit(1);
  }
  const gameId: string = created.data.game_id;
  console.log(`\n${gameId} contra ${opponent}, abre ${first === 1 ? "el equipo" : "la casa"}`);

  for (;;) {
    const next = await call("GET", "/api/next?wait=10");
    if (next.data.status !== "turn") {
      const game = await call("GET", `/api/games/${gameId}`);
      if (game.data.status === "finished") break;
      continue;
    }
    if (next.data.game_id !== gameId) continue;
    const column = pick(next.data.legal_moves);
    const moved = await call("POST", "/api/move", { game_id: gameId, column });
    console.log(`  turno ${next.data.turn}: columna ${column} → ${moved.status} ${moved.data.state ?? moved.data.error} (${moved.ms} ms)`);
    if (moved.status !== 200) failures++;
    if (moved.data.state && moved.data.state !== "playing") break;
  }

  const game = await call("GET", `/api/games/${gameId}`);
  const r = game.data.result;
  const you = created.data.you;
  const verdict = r?.winner === null ? "empate" : r?.winner === you ? "ganó el equipo" : "ganó la casa";
  console.log(`  fin: ${verdict} (${r?.reason}), ${game.data.moves.length} jugadas`);
}

console.log(failures ? `\n${failures} jugadas rechazadas` : "\nTodo bien: sin jugadas rechazadas.");
process.exit(failures ? 1 : 0);

export {};
