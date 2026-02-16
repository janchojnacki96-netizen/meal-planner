"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";

type MealType = "breakfast" | "lunch" | "dinner";

type Recipe = {
  id: number;
  name: string;
  meal_type: MealType;
  base_servings: number;
  tags: string[];
};

type RecipeIngRow = {
  recipe_id: number;
  ingredient_id: number;
};

type Preference = "favorite" | "dislike";

type RecipeView = Recipe & {
  totalIngredients: number;
  haveIngredients: number;
  missingIngredients: number;
  matchRatio: number; // 0..1
};

type RecipePreferenceRow = {
  recipe_id: number;
  preference: Preference;
};

function parseIds(text: string): number[] {
  return text
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => Number(s))
    .filter((n) => Number.isFinite(n));
}

export default function RecipesPage() {
  const supabase = createClient();
  const router = useRouter();

  const [userId, setUserId] = useState<string | null>(null);

  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [recipeIngs, setRecipeIngs] = useState<RecipeIngRow[]>([]);
  const [pantryIds, setPantryIds] = useState<Set<number>>(new Set());

  // preferences: recipe_id -> "favorite" | "dislike"
  const [prefs, setPrefs] = useState<Map<number, Preference>>(new Map());

  const [q, setQ] = useState("");
  const [mealType, setMealType] = useState<"" | MealType>("");
  const [onlyPossible, setOnlyPossible] = useState(false);
  const [sortByMatch, setSortByMatch] = useState(true);
  const [requiredIdsText, setRequiredIdsText] = useState("");

  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);

      const { data: userData } = await supabase.auth.getUser();
      const user = userData.user;

      if (!user) {
        router.push("/login");
        return;
      }

      setUserId(user.id);

      // 1) Przepisy
      const { data: r, error: rErr } = await supabase
        .from("recipes")
        .select("id,name,meal_type,base_servings,tags")
        .order("name");

      if (rErr) console.error(rErr);

      // 2) recipe -> ingredient
      const { data: ri, error: riErr } = await supabase
        .from("recipe_ingredients")
        .select("recipe_id,ingredient_id");

      if (riErr) console.error(riErr);

      // 3) pantry
      const { data: pan, error: panErr } = await supabase
        .from("user_pantry")
        .select("ingredient_id");

      if (panErr) console.error(panErr);

      // 4) preferences
      const { data: p, error: pErr } = await supabase
        .from("user_recipe_preferences")
        .select("recipe_id,preference");

      if (pErr) console.error(pErr);

      const prefMap = new Map<number, Preference>();
      for (const row of (p ?? []) as RecipePreferenceRow[]) {
        prefMap.set(Number(row.recipe_id), row.preference as Preference);
      }

      setRecipes((r ?? []) as Recipe[]);
      setRecipeIngs((ri ?? []) as RecipeIngRow[]);
      setPantryIds(new Set((pan ?? []).map((x) => x.ingredient_id)));
      setPrefs(prefMap);

      setLoading(false);
    })();
  }, [supabase, router]);

  async function setPreference(recipeId: number, preference: Preference | null) {
    if (!userId) return;

    // optimistic UI
    setPrefs((prev) => {
      const next = new Map(prev);
      if (preference === null) next.delete(recipeId);
      else next.set(recipeId, preference);
      return next;
    });

    if (preference === null) {
      const { error } = await supabase
        .from("user_recipe_preferences")
        .delete()
        .eq("user_id", userId)
        .eq("recipe_id", recipeId);

      if (error) console.error(error);
      return;
    }

    const { error } = await supabase
      .from("user_recipe_preferences")
      .upsert(
        { user_id: userId, recipe_id: recipeId, preference },
        { onConflict: "user_id,recipe_id" }
      );

    if (error) console.error(error);
  }

  const recipeViewList: RecipeView[] = useMemo(() => {
    // map recipe_id -> ingredient_id[]
    const map = new Map<number, number[]>();
    for (const row of recipeIngs) {
      const arr = map.get(row.recipe_id) ?? [];
      arr.push(row.ingredient_id);
      map.set(row.recipe_id, arr);
    }

    return recipes.map((r) => {
      const ingIds = map.get(r.id) ?? [];
      const total = ingIds.length;

      let have = 0;
      for (const ingId of ingIds) {
        if (pantryIds.has(ingId)) have++;
      }

      const missing = Math.max(0, total - have);
      const ratio = total > 0 ? have / total : 0;

      return {
        ...r,
        totalIngredients: total,
        haveIngredients: have,
        missingIngredients: missing,
        matchRatio: ratio,
      };
    });
  }, [recipes, recipeIngs, pantryIds]);

  const filtered: RecipeView[] = useMemo(() => {
    const qq = q.trim().toLowerCase();
    const requiredIds = parseIds(requiredIdsText);

    // map recipe_id -> Set(ingredient_id)
    const mapRecipeToIngSet = new Map<number, Set<number>>();
    for (const row of recipeIngs) {
      const set = mapRecipeToIngSet.get(row.recipe_id) ?? new Set<number>();
      set.add(row.ingredient_id);
      mapRecipeToIngSet.set(row.recipe_id, set);
    }

    let list = recipeViewList.filter((r) => {
      // filtr typ posiłku
      if (mealType && r.meal_type !== mealType) return false;

      // filtr wyszukiwania
      if (qq && !(r.name.toLowerCase().includes(qq) || String(r.id).includes(qq))) {
        return false;
      }

      // filtr: wymagane ID składników (recipe musi zawierać wszystkie)
      if (requiredIds.length) {
        const ingSet = mapRecipeToIngSet.get(r.id) ?? new Set<number>();
        for (const req of requiredIds) {
          if (!ingSet.has(req)) return false;
        }
      }

      // filtr: tylko możliwe (masz wszystkie składniki)
      if (onlyPossible && r.missingIngredients > 0) return false;

      return true;
    });

    if (sortByMatch) {
      list = list.sort((a, b) => b.matchRatio - a.matchRatio);
    } else {
      list = list.sort((a, b) => a.name.localeCompare(b.name));
    }

    return list;
  }, [recipeViewList, recipeIngs, q, mealType, onlyPossible, sortByMatch, requiredIdsText]);

  return (
    <main style={{ maxWidth: 980, margin: "20px auto", padding: 16 }}>
      <header>
        <h1 style={{ fontSize: 22, fontWeight: 700 }}>Przepisy</h1>
        <p style={{ opacity: 0.8 }}>
          Dopasowanie do Pantry: pokazuje ile składników do przepisu masz w domu. Możesz też oznaczać ⭐/🚫.
        </p>
      </header>

      <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
        <input
          placeholder="Szukaj po nazwie lub ID (np. 5001)"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ padding: 10 }}
        />

        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
          <select
            value={mealType}
            onChange={(e) => setMealType(e.target.value as "" | MealType)}
            style={{ padding: 10 }}
          >
            <option value="">Wszystkie typy</option>
            <option value="breakfast">Śniadanie</option>
            <option value="lunch">Obiad</option>
            <option value="dinner">Kolacja</option>
          </select>

          <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <input
              type="checkbox"
              checked={onlyPossible}
              onChange={(e) => setOnlyPossible(e.target.checked)}
            />
            Tylko możliwe (mam wszystkie składniki)
          </label>

          <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <input
              type="checkbox"
              checked={sortByMatch}
              onChange={(e) => setSortByMatch(e.target.checked)}
            />
            Sortuj wg dopasowania
          </label>
        </div>

        <input
          placeholder="Wymagane ID składników (np. 101,103)"
          value={requiredIdsText}
          onChange={(e) => setRequiredIdsText(e.target.value)}
          style={{ padding: 10 }}
        />
      </div>

      {loading ? (
        <p style={{ marginTop: 16 }}>Ładowanie…</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, marginTop: 12, display: "grid", gap: 10 }}>
          {filtered.map((r) => {
            const pref = prefs.get(r.id);

            return (
              <li key={r.id} style={{ border: "1px solid #ddd", borderRadius: 10, padding: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 700 }}>
                      <Link href={`/recipes/${r.id}`}>{r.name}</Link>{" "}
                      <span style={{ opacity: 0.6 }}>#{r.id}</span>
                    </div>

                    <div style={{ opacity: 0.8, fontSize: 13 }}>
                      typ: {r.meal_type} • bazowe porcje: {r.base_servings}
                      {r.tags?.length ? ` • tagi: ${r.tags.join(", ")}` : ""}
                    </div>
                  </div>

                  <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontWeight: 700 }}>
                        {r.haveIngredients}/{r.totalIngredients}
                      </div>
                      <div style={{ opacity: 0.8, fontSize: 13 }}>brak: {r.missingIngredients}</div>
                    </div>

                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <button
                        onClick={() => setPreference(r.id, pref === "favorite" ? null : "favorite")}
                        title="Ulubione"
                        style={{ padding: "6px 10px" }}
                      >
                        {pref === "favorite" ? "⭐" : "☆"}
                      </button>

                      <button
                        onClick={() => setPreference(r.id, pref === "dislike" ? null : "dislike")}
                        title="Nie lubię"
                        style={{ padding: "6px 10px" }}
                      >
                        {pref === "dislike" ? "🚫" : "—"}
                      </button>
                    </div>
                  </div>
                </div>
              </li>
            );
          })}

          {!filtered.length && <li style={{ opacity: 0.8 }}>Brak wyników.</li>}
        </ul>
      )}
    </main>
  );
}
