/**
 * Dónde vive el estado del árbitro.
 * - memory: en el proceso. Ideal en local; en Vercel cada instancia tendría su propio estado.
 * - redis: Upstash Redis (Vercel Marketplace). Todo el estado en una llave, con un candado para que
 *   dos jugadas simultáneas no se pisen.
 */
import { Redis } from "@upstash/redis";
import { type ArbiterState, initialState } from "./types.js";

export interface Store {
  readonly kind: "memory" | "redis";
  /** Cada cuánto conviene volver a leer al esperar (long polling, SSE). */
  readonly pollMs: number;
  /** Lectura sin candado. No mutar lo que devuelve. */
  read(): Promise<ArbiterState>;
  /** Lee, aplica `fn` y guarda, con exclusión mutua. */
  update<T>(fn: (state: ArbiterState) => T): Promise<T>;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function memoryStore(): Store {
  const state = initialState();
  let queue: Promise<unknown> = Promise.resolve();
  return {
    kind: "memory",
    pollMs: 100,
    read: async () => state,
    update<T>(fn: (s: ArbiterState) => T) {
      const run = queue.then(() => fn(state));
      queue = run.catch(() => undefined);
      return run;
    },
  };
}

const RELEASE = "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";

export function redisStore(url: string, token: string, prefix: string): Store {
  const redis = new Redis({ url, token });
  const key = `${prefix}:state`;
  const lock = `${prefix}:lock`;

  const read = async () => (await redis.get<ArbiterState>(key)) ?? initialState();

  return {
    kind: "redis",
    pollMs: 400,
    read,
    async update<T>(fn: (s: ArbiterState) => T) {
      const owner = crypto.randomUUID();
      const giveUp = Date.now() + 5_000;
      while ((await redis.set(lock, owner, { nx: true, px: 5_000 })) !== "OK") {
        if (Date.now() > giveUp) throw new Error("No se pudo tomar el candado del estado.");
        await sleep(25);
      }
      try {
        const state = await read();
        const result = fn(state);
        await redis.set(key, state);
        return result;
      } finally {
        await redis.eval(RELEASE, [lock], [owner]);
      }
    },
  };
}

/** Redis si hay credenciales de Upstash (o las de Vercel KV); si no, memoria. */
export function storeFromEnv(env: Record<string, string | undefined> = process.env): Store {
  const url = env.UPSTASH_REDIS_REST_URL ?? env.KV_REST_API_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN ?? env.KV_REST_API_TOKEN;
  if (url && token) {
    // Producción y previews de Vercel no comparten estado aunque usen la misma base.
    const prefix = env.ARBITRO_REDIS_PREFIX ?? `arbitro:${env.VERCEL_ENV ?? "local"}`;
    return redisStore(url, token, prefix);
  }
  return memoryStore();
}
