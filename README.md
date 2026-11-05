# Cuatro en línea 8×7 — árbitro de prueba

Árbitro que sigue el **OpenAPI 1.0.1** del torneo (`spec/arbitro-openapi.json`), desplegable en Vercel, para
probar el bot del equipo contra algo con red de verdad. Incluye un **tablero en vivo** y el demo para jugar
en el navegador.

> No es el árbitro oficial. Reproduce el contrato y las reglas de operación del mock del equipo
> (`tools/mock-arbiter`): mismo JSON, mismos errores y mismos supuestos.

## Qué implementa

| Ruta | Qué hace |
|---|---|
| `GET /api/next?wait=N` | Long polling (0–25 s, 20 por defecto). Entrega el turno más antiguo; el reloj arranca la primera vez que se entrega. |
| `POST /api/move` | `200` aceptada · `400 illegal_move` / `timeout` (pierde) · `400 validation` (no pierde) · `409 not_your_turn` / `unknown_game` (no pierde). |
| `POST /api/practice` | Práctica contra `casa-aleatorio` o `casa-basico`; `423` fuera de la fase de prácticas. |
| `GET /api/me`, `PUT /api/me/submission` | Datos del equipo y entrega (`commit` hexadecimal 7–40, `repo_url` de GitHub o Bitbucket). |
| `GET /api/games`, `/api/games/{id}` | Partidas públicas con `team_id`, `house`, `series`, `current` y `forfeited_by`. |
| `GET /api/standings`, `/api/state`, `/api/live`, `/api/health`, `/api/openapi.json` | Tabla, snapshot, Server-Sent Events, latido y el contrato. |

Reglas: 3 s por jugada desde `served_at`, 30 s de ausencia, liga V 3 · E 1 · D 0, desempates por puntos,
enfrentamiento directo, diferencia V−D y sorteo.

**Equipos por defecto** (tokens de juguete, los mismos del mock): `eq6` → `token-local-eq6` y `rival` →
`token-local-rival`.

## Correr local

```bash
npm install
npm run arbitro    # árbitro en http://127.0.0.1:8787 (estado en memoria)
npm run dev        # tablero en http://localhost:5173 (usa el árbitro local por /api)
npm run smoke      # juega 2 prácticas contra el árbitro
```

Con el bot del equipo (repo `sleipnir-4-in-a-Row`):

```bash
ARBITRO_URL=http://127.0.0.1:8787 TEAM_TOKEN=token-local-eq6 npm run bot
```

## Vercel

1. **Storage → Upstash for Redis** (Marketplace, plan gratis) y conéctalo al proyecto. Vercel agrega
   `KV_REST_API_URL` y `KV_REST_API_TOKEN`. **Sin Redis cada instancia tiene su propio estado** y las partidas
   se pierden o se mezclan; el tablero lo avisa.
2. Vuelve a desplegar. Producción y previews usan llaves distintas (`arbitro:production`, `arbitro:preview`).
3. Prueba: `ARBITRO_URL=https://<tu-proyecto>.vercel.app npm run smoke`.

Las rutas `/api/*` las atiende una sola función (`api/index.ts`, ver `vercel.json`) con `maxDuration` de 60 s.
`/api/live` cierra cada ~50 s y el navegador reconecta solo.

### Variables de entorno (opcionales)

| Variable | Para qué |
|---|---|
| `ARBITRO_TEAMS` | Equipos propios: `id:token:Nombre;id2:token2:Nombre 2`. Sin ella se usan los tokens de juguete, que son públicos. |
| `ARBITRO_ADMIN_TOKEN` | Activa `/api/admin/*` en Vercel (en local el token es `admin-local`). |
| `ARBITRO_DEADLINE_MS`, `ARBITRO_ABSENCE_MS` | Cambiar los 3,000 ms y 30,000 ms. |

### Administración (no está en el OpenAPI)

```bash
A="Authorization: Bearer $ARBITRO_ADMIN_TOKEN"
curl -X POST $URL/api/admin/games -H "$A" -d '{"kind":"league","player1":"eq6","player2":"rival"}'
curl -X POST $URL/api/admin/phase -H "$A" -d '{"phase":"frozen"}'          # practice|frozen|league|playoffs|finished
curl -X POST $URL/api/admin/announcement -H "$A" -d '{"text":"Liga a las 10:00"}'
curl -X POST $URL/api/admin/forfeit -H "$A" -d '{"game_id":"g_3","loser":2}'
curl -X POST $URL/api/admin/reset -H "$A" -d '{}'
```

`player1`/`player2` aceptan ids de equipo o `casa-aleatorio` / `casa-basico`.

## Supuestos (iguales al mock del equipo)

- `column` fuera de 0–7 o que no es entero → `400 validation` (no pierde); columna llena → `400 illegal_move`.
- Pedir dos veces el mismo turno devuelve el mismo `served_at`.
- Jugar sin haber pedido el turno se acepta y cuenta desde ese momento.
- Los bots de la casa responden al instante, así que reintentar un `POST /api/move` cuya respuesta se perdió
  puede contar como la jugada del turno siguiente.
- La forma de `/api/state` es propia: el OpenAPI solo dice "object".
