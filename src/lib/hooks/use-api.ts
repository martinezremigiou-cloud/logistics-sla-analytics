"use client";

import { useCallback, useEffect, useState } from "react";

export interface ApiErrorBody {
  error: string;
  message?: string;
}

export interface UseApiResult<T> {
  data: T | null;
  error: ApiErrorBody | null;
  loading: boolean;
  refetch: () => void;
}

const FALLBACK_ERROR: ApiErrorBody = { error: "internal_error" };

/**
 * Hook cliente de fetch para las rutas de LECTURA de `/api/**`.
 * `url === null` es un estado válido de "idle" (p.ej. mientras se arma un
 * query aún incompleto): no dispara fetch y `loading` queda en `false`.
 */
export function useApi<T>(url: string | null): UseApiResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiErrorBody | null>(null);
  const [loading, setLoading] = useState(false);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (url === null) {
      setData(null);
      setError(null);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const res = await fetch(url, { signal: controller.signal, cache: "no-store" });

        if (!res.ok) {
          let body: ApiErrorBody = FALLBACK_ERROR;
          try {
            body = (await res.json()) as ApiErrorBody;
          } catch {
            // Respuesta de error sin JSON válido: se conserva el fallback.
          }
          setData(null);
          setError(body);
          setLoading(false);
          return;
        }

        const json = (await res.json()) as T;
        setData(json);
        setError(null);
        setLoading(false);
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return;
        setData(null);
        setError(FALLBACK_ERROR);
        setLoading(false);
      }
    })();

    return () => controller.abort();
  }, [url, nonce]);

  const refetch = useCallback(() => setNonce((n) => n + 1), []);

  return { data, error, loading, refetch };
}
