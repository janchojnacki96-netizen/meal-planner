import { Suspense } from "react";
import MealPlanClient from "./MealPlanClient";

export default function Page() {
  return (
    <Suspense fallback={<div className="p-4 text-sm text-gray-500">Ładowanie…</div>}>
      <MealPlanClient />
    </Suspense>
  );
}
