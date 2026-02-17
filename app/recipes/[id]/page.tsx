"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";

type Recipe = {
  id: number;
  name: string;
  meal_type: "breakfast" | "lunch" | "dinner";
  base_servings: number;
  steps: string[];
  tags: string[];
};

type RecipeIngredientJoin = {
  amount: number | null;
  unit: string | null;
  ingredient: {
    id: number;
    name: string;
    unit: string;
    category: string | null;
  };
};

type RecipeIngredientJoinRaw = {
  amount: number | null;
  unit: string | null;
  ingredient: RecipeIngredientJoin["ingredient"] | RecipeIngredientJoin["ingredient"][] | null;
};

function normalizeRecipeIngredients(rows: RecipeIngredientJoinRaw[]): RecipeIngredientJoin[] {
  return rows
    .map((row) => {
      const ingredient = Array.isArray(row.ingredient) ? row.ingredient[0] : row.ingredient;
      if (!ingredient) return null;
      return {
        amount: row.amount ?? null,
        unit: row.unit ?? null,
        ingredient,
      };
    })
    .filter((row): row is RecipeIngredientJoin => row !== null);
}

export default function RecipeDetailsPage() {
  const supabase = createClient();
  const router = useRouter();
  const params = useParams<{ id: string }>();

  const [recipe, setRecipe] = useState<Recipe | null>(null);
  const [items, setItems] = useState<RecipeIngredientJoin[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);

      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) {
        router.push("/login");
        return;
      }

      const recipeId = Number(params.id);
      if (!Number.isFinite(recipeId)) {
        setLoading(false);
        return;
      }

      const { data: r, error: rErr } = await supabase
        .from("recipes")
        .select("id,name,meal_type,base_servings,steps,tags")
        .eq("id", recipeId)
        .single();

      if (rErr) console.error(rErr);

      const { data: ri, error: riErr } = await supabase
        .from("recipe_ingredients")
        .select(
          "amount,unit,ingredient:ingredients!recipe_ingredients_ingredient_id_fkey(id,name,unit,category)"
        )
        .eq("recipe_id", recipeId);

      if (riErr) console.error(riErr);

      const recipeData = (r ?? null) as Recipe | null;
      const itemsData = normalizeRecipeIngredients((ri ?? []) as RecipeIngredientJoinRaw[]);
      setRecipe(recipeData);
      setItems(itemsData);
      setLoading(false);
    })();
  }, [supabase, router, params.id]);

  if (loading) {
    return (
      <main className="card">
        <p className="text-sm text-slate-600">Ładowanie…</p>
      </main>
    );
  }

  if (!recipe) {
    return (
      <main className="space-y-3">
        <div className="card space-y-2">
          <p className="text-sm text-slate-600">Nie znaleziono przepisu.</p>
          <Link href="/recipes" className="text-sm font-semibold text-slate-900 hover:underline">
            ← Wróć do listy
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="space-y-6">
      <Link href="/recipes" className="text-sm font-semibold text-slate-600 hover:text-slate-900 hover:underline">
        ← Wróć do listy
      </Link>

      <header className="space-y-2">
        <h1 className="text-2xl font-semibold text-slate-900">
          {recipe.name} <span className="text-sm text-slate-400">#{recipe.id}</span>
        </h1>
        <p className="text-sm text-slate-600">
          typ: <b className="text-slate-900">{recipe.meal_type}</b> • bazowe porcje:{" "}
          <b className="text-slate-900">{recipe.base_servings}</b>
        </p>
      </header>

      <section className="card space-y-2">
        <h2 className="section-title">Składniki</h2>
        <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
          {items.map((it, idx) => (
            <li key={idx}>
              {it.amount ?? "—"} {it.unit ?? ""} — {it.ingredient?.name}{" "}
              <span className="text-xs text-slate-400">#{it.ingredient?.id}</span>
            </li>
          ))}
          {!items.length && <li className="text-sm text-slate-500">Brak składników.</li>}
        </ul>
      </section>

      <section className="card space-y-2">
        <h2 className="section-title">Kroki</h2>
        <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-700">
          {(recipe.steps ?? []).map((s, idx) => (
            <li key={idx} className="leading-relaxed">
              {s}
            </li>
          ))}
          {(!recipe.steps || recipe.steps.length === 0) && (
            <li className="text-sm text-slate-500">Brak kroków.</li>
          )}
        </ol>
      </section>

      <section className="card space-y-2">
        <h2 className="section-title">Tagi</h2>
        <p className="text-sm text-slate-600">{recipe.tags?.length ? recipe.tags.join(", ") : "—"}</p>
      </section>
    </main>
  );
}
