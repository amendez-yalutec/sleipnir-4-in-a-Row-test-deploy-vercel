/**
 * Función de Vercel: todas las rutas /api/* llegan aquí (ver vercel.json) y las atiende el árbitro.
 * El handler se crea una vez por instancia; el estado vive en Redis si está configurado.
 */
import { createHandler } from "../server/handler.js";

const handle = createHandler();

export const GET = (request: Request) => handle(request);
export const POST = (request: Request) => handle(request);
export const PUT = (request: Request) => handle(request);
export const OPTIONS = (request: Request) => handle(request);
