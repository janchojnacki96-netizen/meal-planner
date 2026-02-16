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
      <main style={{ maxWidth: 820, margin: "20px auto", padding: 16 }}>
        <p>Ładowanie…</p>
      </main>
    );
  }

  if (!recipe) {
    return (
      <main style={{ maxWidth: 820, margin: "20px auto", padding: 16 }}>
        <p>Nie znaleziono przepisu.</p>
        <Link href="/recipes">← Wróć do listy</Link>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 820, margin: "20px auto", padding: 16 }}>
      <Link href="/recipes">← Wróć do listy</Link>

      <h1 style={{ fontSize: 26, fontWeight: 800, marginTop: 10 }}>
        {recipe.name} <span style={{ opacity: 0.6, fontSize: 16 }}>#{recipe.id}</span>
      </h1>

      <p style={{ opacity: 0.85 }}>
        typ: <b>{recipe.meal_type}</b> • bazowe porcje: <b>{recipe.base_servings}</b>
      </p>

      <section style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700 }}>Składniki</h2>
        <ul>
          {items.map((it, idx) => (
            <li key={idx}>
              {it.amount} {it.unit} — {it.ingredient?.name}{" "}
              <span style={{ opacity: 0.6 }}>#{it.ingredient?.id}</span>
            </li>
          ))}
          {!items.length && <li style={{ opacity: 0.8 }}>Brak składników.</li>}
        </ul>
      </section>

      <section style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700 }}>Kroki</h2>
        <ol>
          {(recipe.steps ?? []).map((s, idx) => (
            <li key={idx} style={{ marginBottom: 6 }}>
              {s}
            </li>
          ))}
          {(!recipe.steps || recipe.steps.length === 0) && (
            <li style={{ opacity: 0.8 }}>Brak kroków.</li>
          )}
        </ol>
      </section>

      <section style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700 }}>Tagi</h2>
        <p>{recipe.tags?.length ? recipe.tags.join(", ") : "—"}</p>
      </section>
    </main>
  );
}
