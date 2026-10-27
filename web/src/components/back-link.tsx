"use client";

import type { MouseEvent, ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { returnsToPrevious } from "@/lib/history-back.mjs";

export function BackLink({ href, className, children }: { href: string; className?: string; children: ReactNode }) {
  const router = useRouter();

  function onClick(event: MouseEvent<HTMLAnchorElement>) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (!("navigation" in window)) return;
    const current = window.navigation.currentEntry;
    if (!current) return;
    const previous = window.navigation.entries()[current.index - 1];
    if (previous && returnsToPrevious(href, location.href, previous.url)) {
      event.preventDefault();
      router.back();
    }
  }

  return (
    <Link href={href} className={className} onClick={onClick}>
      {children}
    </Link>
  );
}
