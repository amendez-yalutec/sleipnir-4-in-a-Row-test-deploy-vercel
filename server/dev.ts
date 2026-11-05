/**
 * Árbitro local: `npm run arbitro` → http://127.0.0.1:8787 (mismo puerto que el mock del equipo).
 * Estado en memoria, salvo que haya credenciales de Upstash en el entorno.
 */
import { createServer } from "node:http";
import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { createHandler } from "./handler.js";
import { loadConfig } from "./config.js";

const port = Number(process.env.ARBITRO_PORT ?? 8787);
const host = process.env.ARBITRO_HOST ?? "127.0.0.1";
const config = loadConfig();
const handle = createHandler({ config });

createServer(async (req, res) => {
  const abort = new AbortController();
  res.on("close", () => abort.abort());
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const method = req.method ?? "GET";
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (typeof value === "string") headers.set(name, value);
    else if (Array.isArray(value)) headers.set(name, value.join(", "));
  }
  const request = new Request(`http://${req.headers.host ?? `${host}:${port}`}${req.url ?? "/"}`, {
    method,
    headers,
    body: method === "GET" || method === "HEAD" ? undefined : Buffer.concat(chunks),
    signal: abort.signal,
  });
  try {
    const response = await handle(request);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    if (response.body) {
      for await (const chunk of Readable.fromWeb(response.body as unknown as NodeReadableStream)) {
        if (!res.destroyed) res.write(chunk);
      }
    }
  } catch (error) {
    if (!res.headersSent) res.writeHead(500);
    console.error(error);
  }
  res.end();
}).listen(port, host, () => {
  console.log(`Árbitro de prueba en http://${host}:${port}`);
  console.log(`Equipos: ${config.teams.map((t) => `${t.id} (token ${t.token})`).join(", ")}`);
  console.log(`Admin: ${config.adminToken ? `token ${config.adminToken}` : "desactivado"}`);
});
