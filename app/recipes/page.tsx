"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Ban, Filter, Star, X } from "lucide-react";

type MealType = "breakfast" | "lunch" | "dinner";

type RecipeRaw = {
  id: number;
  name: string;
  meal_type: MealType;
  base_servings: number;
  tags: string[] | string | null;
};

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
  matchRatio: number;
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

function normalizeTags(value: string[] | string | null): string[] {
  if (Array.isArray(value)) {
    return value.map((x) => String(x).trim()).filter(Boolean);
  }
  if (typeof value === "string") {
    return value
      .split("|")
      .map((x) => x.trim())
      .filter(Boolean);
  }
  return [];
}

function mealTypeLabel(type: MealType): string {
  if (type === "breakfast") return "Śniadanie";
  if (type === "lunch") return "Obiad";
  return "Kolacja";
}

export default function RecipesPage() {
  const supabase = createClient();
  const router = useRouter();

  const [userId, setUserId] = useState<string | null>(null);

  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [recipeIngs, setRecipeIngs] = useState<RecipeIngRow[]>([]);
  const [pantryIds, setPantryIds] = useState<Set<number>>(new Set());

  const [prefs, setPrefs] = useState<Map<number, Preference>>(new Map());

  const [q, setQ] = useState("");
  const [mealType, setMealType] = useState<"" | MealType>("");
  const [onlyPossible, setOnlyPossible] = useState(false);
  const [sortByMatch, setSortByMatch] = useState(true);
  const [requiredIdsText, setRequiredIdsText] = useState("");
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);

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

      const { data: r, error: rErr } = await supabase
        .from("recipes")
        .select("id,name,meal_type,base_servings,tags")
        .order("name");

      if (rErr) console.error(rErr);

      const { data: ri, error: riErr } = await supabase
        .from("recipe_ingredients")
        .select("recipe_id,ingredient_id");

      if (riErr) console.error(riErr);

      const { data: pan, error: panErr } = await supabase.from("user_pantry").select("ingredient_id");

      if (panErr) console.error(panErr);

      const { data: p, error: pErr } = await supabase
        .from("user_recipe_preferences")
        .select("recipe_id,preference");

      if (pErr) console.error(pErr);

      const prefMap = new Map<number, Preference>();
      for (const row of (p ?? []) as RecipePreferenceRow[]) {
        prefMap.set(Number(row.recipe_id), row.preference as Preference);
      }

      const normalizedRecipes = ((r ?? []) as RecipeRaw[]).map((row) => ({
        id: Number(row.id),
        name: row.name,
        meal_type: row.meal_type,
        base_servings: Number(row.base_servings ?? 1),
        tags: normalizeTags(row.tags),
      }));

      setRecipes(normalizedRecipes);
      setRecipeIngs((ri ?? []) as RecipeIngRow[]);
      setPantryIds(new Set((pan ?? []).map((x) => Number(x.ingredient_id))));
      setPrefs(prefMap);

      setLoading(false);
    })();
  }, [supabase, router]);

  async function setPreference(recipeId: number, preference: Preference | null) {
    if (!userId) return;

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

  const availableTags = useMemo(() => {
    const tags = new Set<string>();
    for (const recipe of recipes) {
      for (const tag of recipe.tags) tags.add(tag);
    }
    return Array.from(tags).sort((a, b) => a.localeCompare(b));
  }, [recipes]);

  const filtered: RecipeView[] = useMemo(() => {
    const qq = q.trim().toLowerCase();
    const requiredIds = parseIds(requiredIdsText);

    const mapRecipeToIngSet = new Map<number, Set<number>>();
    for (const row of recipeIngs) {
      const set = mapRecipeToIngSet.get(row.recipe_id) ?? new Set<number>();
      set.add(row.ingredient_id);
      mapRecipeToIngSet.set(row.recipe_id, set);
    }

    let list = recipeViewList.filter((r) => {
      if (mealType && r.meal_type !== mealType) return false;

      if (qq && !(r.name.toLowerCase().includes(qq) || String(r.id).includes(qq))) {
        return false;
      }

      if (requiredIds.length) {
        const ingSet = mapRecipeToIngSet.get(r.id) ?? new Set<number>();
        for (const req of requiredIds) {
          if (!ingSet.has(req)) return false;
        }
      }

      if (onlyPossible && r.missingIngredients > 0) return false;

      if (selectedTags.size > 0) {
        // OR semantics: recipe passes if it has at least one selected tag.
        const hasAny = r.tags.some((tag) => selectedTags.has(tag));
        if (!hasAny) return false;
      }

      return true;
    });

    if (sortByMatch) {
      list = list.sort((a, b) => b.matchRatio - a.matchRatio);
    } else {
      list = list.sort((a, b) => a.name.localeCompare(b.name));
    }

    return list;
  }, [recipeViewList, recipeIngs, q, mealType, onlyPossible, sortByMatch, requiredIdsText, selectedTags]);

  function toggleTag(tag: string) {
    setSelectedTags((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });
  }

  const filtersContent = (
    <div className="space-y-3">
      <input
        placeholder="Szukaj po nazwie lub ID (np. 5001)"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        className="input"
      />

      <div className="flex flex-wrap items-center gap-3">
        <select value={mealType} onChange={(e) => setMealType(e.target.value as "" | MealType)} className="input min-h-11 sm:w-auto">
          <option value="">Wszystkie typy</option>
          <option value="breakfast">Śniadanie</option>
          <option value="lunch">Obiad</option>
          <option value="dinner">Kolacja</option>
        </select>

        <label className="flex min-h-11 items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={onlyPossible} onChange={(e) => setOnlyPossible(e.target.checked)} className="h-4 w-4" />
          Tylko możliwe
        </label>

        <label className="flex min-h-11 items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={sortByMatch} onChange={(e) => setSortByMatch(e.target.checked)} className="h-4 w-4" />
          Sortuj wg dopasowania
        </label>
      </div>

      <input
        placeholder="Wymagane ID składników (np. 101,103)"
        value={requiredIdsText}
        onChange={(e) => setRequiredIdsText(e.target.value)}
        className="input"
      />

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Tagi</div>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={selectedTags.size === 0}
            onClick={() => setSelectedTags(new Set())}
          >
            Wyczyść tagi
          </Button>
        </div>
        {availableTags.length === 0 ? (
          <p className="text-xs text-slate-500">Brak tagów w danych.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {availableTags.map((tag) => {
              const active = selectedTags.has(tag);
              return (
                <button
                  key={tag}
                  type="button"
                  onClick={() => toggleTag(tag)}
                  className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
                    active
                      ? "border-slate-900 bg-slate-900 text-white"
                      : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  {tag}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );

  return (
    <main className="space-y-6">
      <header className="flex items-start justify-between gap-3">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold text-slate-900">Przepisy</h1>
          <p className="text-sm text-slate-600">
            Dopasowanie do Pantry pokazuje ile składników do przepisu masz w domu. Możesz też oznaczać ulubione i zablokowane.
          </p>
        </div>
        <Button
          type="button"
          variant="secondary"
          className="min-h-11 px-3 lg:hidden"
          onClick={() => setMobileFiltersOpen((prev) => !prev)}
        >
          <Filter className="h-4 w-4" />
          Filtry
        </Button>
      </header>

      <section className="card p-0 lg:hidden">
        <Accordion
          type="single"
          collapsible
          value={mobileFiltersOpen ? "filters" : undefined}
          onValueChange={(value) => setMobileFiltersOpen(value === "filters")}
        >
          <AccordionItem value="filters" className="border-0 px-4">
            <AccordionTrigger>Filtry</AccordionTrigger>
            <AccordionContent>{filtersContent}</AccordionContent>
          </AccordionItem>
        </Accordion>
      </section>

      <section className="card hidden space-y-3 lg:block">{filtersContent}</section>

      {loading ? (
        <p className="text-sm text-slate-500">Ładowanie…</p>
      ) : (
        <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((r) => {
            const pref = prefs.get(r.id);

            return (
              <li key={r.id} className="card flex flex-col gap-4">
                <div className="space-y-2">
                  <div className="text-base font-semibold text-slate-900">
                    <Link href={`/recipes/${r.id}`} className="hover:underline">
                      {r.name}
                    </Link>{" "}
                    <span className="text-xs text-slate-400">#{r.id}</span>
                  </div>

                  <div className="text-xs text-slate-500">
                    typ: {mealTypeLabel(r.meal_type)} • bazowe porcje: {r.base_servings}
                  </div>

                  {r.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {r.tags.map((tag) => (
                        <Badge key={`${r.id}-${tag}`} variant="outline">
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>

                <div className="flex items-center justify-between gap-3">
                  <div className="text-xs text-slate-500">
                    <div className="text-sm font-semibold text-slate-900">
                      {r.haveIngredients}/{r.totalIngredients}
                    </div>
                    brak: {r.missingIngredients}
                  </div>

                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant={pref === "favorite" ? "default" : "secondary"}
                      size="icon"
                      className="h-11 w-11"
                      onClick={() => {
                        void setPreference(r.id, pref === "favorite" ? null : "favorite");
                      }}
                      aria-label={`Oznacz ${r.name} jako ulubiony`}
                    >
                      <Star className={`h-4 w-4 ${pref === "favorite" ? "fill-current" : ""}`} />
                    </Button>

                    <Button
                      type="button"
                      variant={pref === "dislike" ? "destructive" : "secondary"}
                      size="icon"
                      className="h-11 w-11"
                      onClick={() => {
                        void setPreference(r.id, pref === "dislike" ? null : "dislike");
                      }}
                      aria-label={`Zablokuj ${r.name}`}
                    >
                      <Ban className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </li>
            );
          })}

          {!filtered.length && (
            <li className="card text-sm text-slate-500">
              Brak wyników.
              {(q || mealType || selectedTags.size > 0 || requiredIdsText || onlyPossible) && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="ml-2"
                  onClick={() => {
                    setQ("");
                    setMealType("");
                    setRequiredIdsText("");
                    setOnlyPossible(false);
                    setSelectedTags(new Set());
                  }}
                >
                  <X className="h-4 w-4" />
                  Wyczyść filtry
                </Button>
              )}
            </li>
          )}
        </ul>
      )}
    </main>
  );
}
