"use client";

import { useCallback, useEffect, useState } from "react";

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const res = await fetch(path, { ...init, headers, cache: "no-store" });
  const text = await res.text();
  let data: { ok?: boolean; error?: string } = {};
  if (text) {
    try {
      data = JSON.parse(text) as { ok?: boolean; error?: string };
    } catch {
      throw new ApiError("The server returned an unreadable response.", res.status);
    }
  }
  if (!res.ok || data.ok === false) {
    throw new ApiError(data.error || "Request failed.", res.status);
  }
  return data as T;
}

export function useApi<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(path));

  const reload = useCallback(async () => {
    if (!path) return;
    setLoading(true);
    try {
      const next = await api<T>(path);
      setData(next);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load.");
    } finally {
      setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { data, error, loading, reload, setData };
}
