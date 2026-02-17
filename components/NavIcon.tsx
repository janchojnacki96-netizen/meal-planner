"use client";

import type { LucideProps } from "lucide-react";
import {
  BookOpen,
  CalendarDays,
  ListChecks,
  Settings2,
  Upload,
  Warehouse,
} from "lucide-react";
import type { NavIconKey } from "@/lib/nav-links";

type NavIconProps = {
  icon: NavIconKey;
  className?: string;
} & LucideProps;

export default function NavIcon({ icon, className, ...props }: NavIconProps) {
  if (icon === "meal-plan") return <CalendarDays className={className} {...props} />;
  if (icon === "shopping-list") return <ListChecks className={className} {...props} />;
  if (icon === "pantry") return <Warehouse className={className} {...props} />;
  if (icon === "recipes") return <BookOpen className={className} {...props} />;
  if (icon === "preferences") return <Settings2 className={className} {...props} />;
  return <Upload className={className} {...props} />;
}
