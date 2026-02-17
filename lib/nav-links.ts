export type NavLink = {
  href: string;
  label: string;
  exact?: boolean;
  matchPrefix?: string;
  icon?: string;
  primary?: boolean;
};

export const NAV_LINKS: NavLink[] = [
  { href: "/meal-plan", label: "Jadłospis", icon: "🍽️", primary: true },
  { href: "/shopping-list", label: "Lista zakupów", icon: "🛒", primary: true },
  { href: "/pantry", label: "Pantry", icon: "🧺", primary: true },
  { href: "/recipes", label: "Przepisy", icon: "📖", matchPrefix: "/recipes", primary: true },
  { href: "/preferences", label: "Preferencje", icon: "⚙️" },
  { href: "/admin/import", label: "Import", icon: "⬆️" },
];

export const PRIMARY_NAV_LINKS = NAV_LINKS.filter((link) => link.primary);
export const SECONDARY_NAV_LINKS = NAV_LINKS.filter((link) => !link.primary);
