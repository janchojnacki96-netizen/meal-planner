"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import NavBar from "./NavBar";

type AppShellProps = {
  children: ReactNode;
};

export default function AppShell({ children }: AppShellProps) {
  const pathname = usePathname();

  if (pathname === "/login") {
    return <>{children}</>;
  }

  return (
    <>
      <NavBar />
      {children}
    </>
  );
}
