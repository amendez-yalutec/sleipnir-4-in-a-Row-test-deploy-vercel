/** Llamadas al árbitro desde el navegador, con el token guardado solo en esta pestaña. */

export function loadToken(key: string): string {
  try {
    return sessionStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

export function saveToken(key: string, value: string): void {
  try {
    if (value) sessionStorage.setItem(key, value);
    else sessionStorage.removeItem(key);
  } catch {
    /* almacenamiento bloqueado: el token vive solo en memoria */
  }
}

export interface ApiResult<T = Record<string, unknown>> {
  ok: boolean;
  status: number;
  data: T;
}

export async function api<T = Record<string, unknown>>(
  method: string,
  path: string,
  token: string,
  body?: unknown,
): Promise<ApiResult<T>> {
  try {
    const res = await fetch(path, {
      method,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as T;
    return { ok: res.ok, status: res.status, data };
  } catch {
    return { ok: false, status: 0, data: { message: "No se pudo conectar con el árbitro." } as T };
  }
}

export const errorText = (r: ApiResult): string =>
  typeof r.data.message === "string" ? r.data.message : `Error ${r.status}`;
