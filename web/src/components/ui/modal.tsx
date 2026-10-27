"use client";

import { useEffect, useEffectEvent, useRef, type RefObject, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { cycleFocusIndex } from "@/lib/modal-focus.mjs";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

export function Modal({
  isOpen,
  onClose,
  labelledBy,
  initialFocusRef,
  children,
  panelClassName,
  overlayClassName,
}: {
  isOpen: boolean;
  onClose: () => void;
  labelledBy: string;
  initialFocusRef?: RefObject<HTMLElement | null>;
  children: ReactNode;
  panelClassName?: string;
  overlayClassName?: string;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const close = useEffectEvent(onClose);
  useEffect(() => {
    if (!isOpen) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusable = () => Array.from(panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
    (initialFocusRef?.current ?? focusable()[0])?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        close();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusable();
      if (!items.length) return;
      const current = items.indexOf(document.activeElement as HTMLElement);
      const next = cycleFocusIndex(current < 0 ? (event.shiftKey ? 0 : items.length - 1) : current, items.length, event.shiftKey);
      event.preventDefault();
      items[next]?.focus();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [initialFocusRef, isOpen]);

  if (!isOpen) return null;
  return (
    <div
      className={cn("fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-md transition-opacity", overlayClassName)}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        className={cn("relative max-h-[90vh] w-full overflow-y-auto rounded-2xl border border-border bg-surface p-6 shadow-2xl", panelClassName)}
      >
        {children}
      </div>
    </div>
  );
}
