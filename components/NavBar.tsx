"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_LINKS, type NavLink } from "@/lib/nav-links";
import styles from "./NavBar.module.css";

function isActiveLink(pathname: string, link: NavLink): boolean {
  if (link.exact) return pathname === link.href;
  if (link.matchPrefix) return pathname.startsWith(link.matchPrefix);
  if (link.href === "/") return pathname === "/";
  return pathname === link.href;
}

export default function NavBar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <header className={styles.header}>
      <div className={styles.inner}>
        <div className={styles.topRow}>
          <Link className={styles.brand} href="/meal-plan">
            Meal Planner
          </Link>
          <button
            type="button"
            className={styles.toggle}
            aria-label="Toggle navigation"
            aria-expanded={open}
            aria-controls="global-navigation"
            onClick={() => setOpen((prev) => !prev)}
          >
            {open ? "Close" : "Menu"}
          </button>
        </div>

        <nav
          id="global-navigation"
          className={`${styles.nav} ${open ? styles.open : ""}`}
        >
          {NAV_LINKS.map((link) => {
            const active = isActiveLink(pathname, link);
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`${styles.link} ${active ? styles.active : ""}`}
                aria-current={active ? "page" : undefined}
                onClick={() => setOpen(false)}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
