export type NavIconKey =
  | "meal-plan"
  | "shopping-list"
  | "pantry"
  | "recipes"
  | "preferences"
  | "import";

export type NavLink = {
  href: string;
  label: string;
  exact?: boolean;
  matchPrefix?: string;
  icon: NavIconKey;
  primary?: boolean;
};

export const NAV_LINKS: NavLink[] = [
  { href: "/meal-plan", label: "Jadłospis", icon: "meal-plan", primary: true },
  { href: "/shopping-list", label: "Lista zakupów", icon: "shopping-list", primary: true },
  { href: "/pantry", label: "Pantry", icon: "pantry", primary: true },
  { href: "/recipes", label: "Przepisy", icon: "recipes", matchPrefix: "/recipes", primary: true },
  { href: "/preferences", label: "Preferencje", icon: "preferences" },
  { href: "/admin/import", label: "Import", icon: "import" },
];

export const PRIMARY_NAV_LINKS = NAV_LINKS.filter((link) => link.primary);
export const SECONDARY_NAV_LINKS = NAV_LINKS.filter((link) => !link.primary);
