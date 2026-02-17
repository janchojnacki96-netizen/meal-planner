"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_LINKS, SECONDARY_NAV_LINKS, type NavLink } from "@/lib/nav-links";
import NavIcon from "./NavIcon";

function isActiveLink(pathname: string, link: NavLink): boolean {
  if (link.exact) return pathname === link.href;
  if (link.matchPrefix) return pathname.startsWith(link.matchPrefix);
  return pathname === link.href;
}

type SidebarNavProps = {
  onNavigate?: () => void;
};

export default function SidebarNav({ onNavigate }: SidebarNavProps) {
  const pathname = usePathname();
  const primary = NAV_LINKS.filter((link) => link.primary);
  const secondary = SECONDARY_NAV_LINKS;

  return (
    <nav className="flex flex-col gap-6 px-4 pb-6 pt-4">
      <div className="flex flex-col gap-1">
        {primary.map((link) => {
          const active = isActiveLink(pathname, link);
          return (
            <Link
              key={link.href}
              href={link.href}
              onClick={onNavigate}
              className={`flex min-h-11 items-center gap-3 rounded-2xl px-3 py-2 text-sm font-semibold transition ${
                active ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-100"
              }`}
              aria-current={active ? "page" : undefined}
            >
              <NavIcon icon={link.icon} className="h-5 w-5 shrink-0" />
              <span>{link.label}</span>
            </Link>
          );
        })}
      </div>

      {secondary.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="px-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Ustawienia</div>
          {secondary.map((link) => {
            const active = isActiveLink(pathname, link);
            return (
              <Link
                key={link.href}
                href={link.href}
                onClick={onNavigate}
                className={`flex min-h-11 items-center gap-3 rounded-xl px-3 py-2 text-sm transition ${
                  active ? "bg-slate-200 text-slate-900" : "text-slate-600 hover:bg-slate-100"
                }`}
                aria-current={active ? "page" : undefined}
              >
                <NavIcon icon={link.icon} className="h-5 w-5 shrink-0" />
                <span>{link.label}</span>
              </Link>
            );
          })}
        </div>
      )}
    </nav>
  );
}
