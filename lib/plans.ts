export type PlanForLabel = {
  id: string;
  start_date: string;
  created_at: string;
};

export function isoToDDMMYYYY(iso: string): string {
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return iso;
  return `${d}.${m}.${y}`;
}

export function buildPlanVersionMap(plans: PlanForLabel[]): Map<string, number> {
  const groups = new Map<string, PlanForLabel[]>();
  for (const pl of plans) {
    const arr = groups.get(pl.start_date) ?? [];
    arr.push(pl);
    groups.set(pl.start_date, arr);
  }

  const versionMap = new Map<string, number>();
  for (const [, arr] of groups.entries()) {
    const sorted = [...arr].sort((a, b) => a.created_at.localeCompare(b.created_at));
    sorted.forEach((pl, idx) => versionMap.set(pl.id, idx + 1));
  }

  return versionMap;
}

export function formatPlanLabel(plan: PlanForLabel, versionById?: Map<string, number>): string {
  const v = versionById?.get(plan.id) ?? 1;
  return `${isoToDDMMYYYY(plan.start_date)}_v${v}`;
}
