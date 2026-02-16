export type NavLink = {
  href: string;
  label: string;
  exact?: boolean;
  matchPrefix?: string;
};

export const NAV_LINKS: NavLink[] = [
  { href: "/", label: "Strona główna", exact: true },
  { href: "/meal-plan", label: "Jadłospis" },
  { href: "/pantry", label: "Spiżarnia" },
  { href: "/shopping-list", label: "Lista zakupów" },
  { href: "/recipes", label: "Przepisy", exact: true },
  { href: "/recipes/1", label: "Przepis (szczegóły)", matchPrefix: "/recipes/" },
  { href: "/preferences", label: "Preferencje" },
  { href: "/admin/import", label: "Import" },
  { href: "/login", label: "Logowanie" },
];
