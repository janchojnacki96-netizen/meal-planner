"use client";

import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import SidebarNav from "./SidebarNav";
import MobileDrawer from "./MobileDrawer";
import { BottomNavActionProvider, type BottomNavAction } from "./BottomNavActionContext";
import { Button } from "@/components/ui/button";
import { PRIMARY_NAV_LINKS, SECONDARY_NAV_LINKS } from "@/lib/nav-links";

type AppShellProps = {
  children: ReactNode;
};

function getTitle(pathname: string): string {
  const links = [...PRIMARY_NAV_LINKS, ...SECONDARY_NAV_LINKS];
  const matched = links.find((link) => {
    if (link.exact) return pathname === link.href;
    if (link.matchPrefix) return pathname.startsWith(link.matchPrefix);
    return pathname === link.href;
  });
  return matched?.label ?? "Meal Planner";
}

export default function AppShell({ children }: AppShellProps) {
  const pathname = usePathname();
  const [navOpen, setNavOpen] = useState(false);
  const [bottomNavAction, setBottomNavAction] = useState<BottomNavAction | null>(null);

  const pageTitle = useMemo(() => getTitle(pathname), [pathname]);
  const isMealPlanRoute = pathname.startsWith("/meal-plan");

  if (pathname === "/login") {
    return <>{children}</>;
  }

  return (
    <BottomNavActionProvider value={{ setBottomNavAction }}>
      <div className="min-h-screen bg-slate-50 text-slate-900">
        <MobileDrawer open={navOpen} onClose={() => setNavOpen(false)} title="Menu" side="left">
          <SidebarNav onNavigate={() => setNavOpen(false)} />
        </MobileDrawer>

        <div className="lg:flex">
          <aside className="hidden lg:flex lg:w-64 lg:flex-col lg:gap-6 lg:border-r lg:border-slate-200 lg:bg-white/70 lg:backdrop-blur">
            <div className="px-6 pt-6">
              <Link href="/meal-plan" className="text-lg font-semibold tracking-tight">
                Meal Planner
              </Link>
              <p className="mt-1 text-xs text-slate-500">Plan, kupuj, gotuj.</p>
            </div>
            <SidebarNav />
          </aside>

          <div className="min-w-0 flex-1">
            <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/85 backdrop-blur lg:hidden">
              <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  aria-label="Otwórz menu"
                  onClick={() => setNavOpen(true)}
                >
                  Menu
                </Button>
                <div className="text-sm font-semibold tracking-tight text-slate-900">{pageTitle}</div>
                <div className="h-8 w-12" />
              </div>
            </header>

            <div className="mx-auto w-full max-w-6xl px-3 pb-28 pt-4 sm:px-4 lg:px-8 lg:pb-10">{children}</div>
          </div>
        </div>

        <nav className="fixed bottom-0 left-0 right-0 z-40 border-t border-slate-200 bg-white/90 backdrop-blur lg:hidden">
          <div className={`mx-auto grid max-w-6xl px-2 ${isMealPlanRoute ? "grid-cols-5" : "grid-cols-4"}`}>
            {PRIMARY_NAV_LINKS.map((link) => {
              const active = link.matchPrefix ? pathname.startsWith(link.matchPrefix) : pathname === link.href;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`flex flex-col items-center gap-1 px-2 py-2 text-[11px] font-medium transition ${
                    active ? "text-slate-900" : "text-slate-500"
                  }`}
                  aria-current={active ? "page" : undefined}
                >
                  <span className="text-base">{link.icon ?? "•"}</span>
                  <span className="truncate">{link.label}</span>
                </Link>
              );
            })}
            {isMealPlanRoute && (
              <button
                type="button"
                onClick={() => bottomNavAction?.onClick()}
                disabled={bottomNavAction?.disabled ?? true}
                className={`flex flex-col items-center gap-1 px-2 py-2 text-[11px] font-medium transition ${
                  bottomNavAction && !(bottomNavAction.disabled ?? false) ? "text-slate-900" : "text-slate-400"
                }`}
                aria-label={bottomNavAction?.label ?? "Cofnij"}
              >
                <span className="text-base">↩</span>
                <span className="truncate">{bottomNavAction?.label ?? "Cofnij"}</span>
              </button>
            )}
          </div>
        </nav>
      </div>
    </BottomNavActionProvider>
  );
}
