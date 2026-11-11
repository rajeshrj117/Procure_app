"use client";

import { createContext, useCallback, useContext, useState } from "react";

type Toast = { id: number; message: string; tone: "ok" | "err" };
const ToastContext = createContext<(message: string, tone?: "ok" | "err") => void>(() => undefined);

export function useToast() {
  return useContext(ToastContext);
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((message: string, tone: "ok" | "err" = "ok") => {
    const id = Date.now() + Math.random();
    setToasts((current) => [...current, { id, message, tone }]);
    setTimeout(() => setToasts((current) => current.filter((toast) => toast.id !== id)), 4600);
  }, []);

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[80] flex w-[min(22rem,calc(100vw-2rem))] flex-col gap-2">
        {toasts.map((toast) => (
          <div key={toast.id} className={`pointer-events-auto rounded-xl border bg-white px-4 py-3 text-sm shadow-lg ${toast.tone === "err" ? "border-red-200 text-red-800" : "border-[#d7e7dc] text-[#17613d]"}`}>
            {toast.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
