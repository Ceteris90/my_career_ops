"use client";

import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { LIST_SEARCH_DEBOUNCE_MS, nextSearchWrite } from "@/lib/list-search-sync.mjs";

type SearchParamsLike = { get: (key: string) => string | null };

/**
 * Local list search that is also written to `q` once typing pauses.
 * The detail link can include the typed value immediately. Reload and Back
 * read the list URL, so the URL has to catch up without a write per keystroke.
 */
export function useListSearch(
  params: SearchParamsLike,
  setParams: (updates: Record<string, string | number | null>) => void,
  qRef: MutableRefObject<string>,
) {
  const [q, setQ] = useState(() => params.get("q") ?? "");
  qRef.current = q;
  const pendingRef = useRef<string | null>(null);
  const seenUrl = useRef(params.get("q") ?? "");
  const setParamsRef = useRef(setParams);
  setParamsRef.current = setParams;
  // Depend on the query text, not the search-params object. A parent re-render
  // hands the effect a new params object and would cancel the pause forever.
  const urlQ = params.get("q") ?? "";

  useEffect(() => {
    const decision = nextSearchWrite({
      local: q,
      url: urlQ,
      pending: pendingRef.current,
      urlChanged: urlQ !== seenUrl.current,
    });
    seenUrl.current = urlQ;
    if (decision.clearPending) pendingRef.current = null;
    if (decision.adopt) {
      setQ(urlQ);
      return;
    }
    if (decision.write == null) return;
    const write = decision.write;
    const handle = window.setTimeout(() => {
      if (qRef.current !== write) return;
      pendingRef.current = write;
      setParamsRef.current({ q: write ? write : null });
    }, LIST_SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [q, urlQ, qRef]);

  return { q, setQ };
}
