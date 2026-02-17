"use client";

import type { ReactNode } from "react";
import { useEffect } from "react";

type MobileDrawerProps = {
  open: boolean;
  onClose: () => void;
  title?: string;
  side?: "left" | "right" | "bottom";
  children: ReactNode;
};

export default function MobileDrawer({
  open,
  onClose,
  title,
  side = "left",
  children,
}: MobileDrawerProps) {
  useEffect(() => {
    if (!open) return;
    const original = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = original;
    };
  }, [open]);

  const isBottom = side === "bottom";
  const isRight = side === "right";

  const panelBase = isBottom
    ? "bottom-0 left-0 right-0 max-h-[80vh] rounded-t-2xl"
    : `top-0 ${isRight ? "right-0" : "left-0"} h-full w-72`;
  const panelTranslate = isBottom
    ? open
      ? "translate-y-0"
      : "translate-y-full"
    : open
    ? "translate-x-0"
    : isRight
    ? "translate-x-full"
    : "-translate-x-full";

  return (
    <div className={`fixed inset-0 z-50 ${open ? "" : "pointer-events-none"}`} aria-hidden={!open}>
      <button
        type="button"
        onClick={onClose}
        className={`absolute inset-0 bg-black/40 transition-opacity ${open ? "opacity-100" : "opacity-0"}`}
        aria-label="Zamknij"
      />
      <div
        className={`absolute ${panelBase} flex flex-col gap-4 bg-white p-4 shadow-xl transition-transform ${panelTranslate}`}
      >
        <div className="flex items-center justify-between">
          <div className="text-sm font-semibold text-slate-900">{title ?? "Menu"}</div>
          <button type="button" className="btn btn-secondary text-xs" onClick={onClose}>
            Zamknij
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}
