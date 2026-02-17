"use client";

import { createContext, useContext } from "react";

export type BottomNavAction = {
  label: string;
  onClick: () => void;
  disabled?: boolean;
};

type BottomNavActionContextValue = {
  setBottomNavAction: (action: BottomNavAction | null) => void;
};

const BottomNavActionContext = createContext<BottomNavActionContextValue | null>(null);

export function BottomNavActionProvider({
  value,
  children,
}: {
  value: BottomNavActionContextValue;
  children: React.ReactNode;
}) {
  return <BottomNavActionContext.Provider value={value}>{children}</BottomNavActionContext.Provider>;
}

export function useBottomNavAction() {
  const ctx = useContext(BottomNavActionContext);
  if (!ctx) {
    throw new Error("useBottomNavAction must be used inside BottomNavActionProvider");
  }
  return ctx;
}
