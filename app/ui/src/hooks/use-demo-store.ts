import { useCallback, useEffect, useState } from "react";
import { loadStore, saveStore, type DemoStore } from "@/lib/demo-store";

/** Reactive access to the localStorage-backed demo store (see lib/demo-store.ts). */
export function useDemoStore(): [DemoStore, (fn: (store: DemoStore) => DemoStore) => void] {
  const [store, setStore] = useState<DemoStore>(() => loadStore());

  useEffect(() => {
    const refresh = () => setStore(loadStore());
    window.addEventListener("poh:demo-store-changed", refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener("poh:demo-store-changed", refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  const update = useCallback((fn: (store: DemoStore) => DemoStore) => {
    setStore((current) => {
      const next = fn(current);
      saveStore(next);
      return next;
    });
  }, []);

  return [store, update];
}
