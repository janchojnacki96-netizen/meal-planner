"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Pref = "favorite" | "dislike";
type MealType = "breakfast" | "lunch" | "dinner";

type PrefRow = {
  recipe_id: number;
  preference: Pref;
};

type Recipe = {
  id: number;
  name: string;
  meal_type: MealType;
};

type Ingredient = {
  id: number;
  name: string;
  unit: string;
  category: string | null;
};

type BlockedIngredientRow = {
  ingredient_id: number;
};

type PrefItem = {
  recipe_id: number;
  preference: Pref;
  recipe?: Recipe;
};

type SupabaseErrorLike = {
  message?: string;
  details?: string;
  hint?: string;
  code?: string;
} | null;

function logSupabaseError(context: string, error: SupabaseErrorLike) {
  if (!error) return;
  console.error(context, {
    message: error.message,
    details: error.details,
    hint: error.hint,
    code: error.code,
    raw: error,
  });
}

function formatBlockedLoadError(error: SupabaseErrorLike): string {
  const base = error?.message ?? "Nie udalo sie wczytac zablokowanych produktow.";
  const lower = base.toLowerCase();
  if (
    lower.includes("relation") ||
    lower.includes("permission") ||
    lower.includes("rls") ||
    error?.code === "42501"
  ) {
    return `${base} Jesli nie masz tabeli user_blocked_ingredients lub polityk RLS, uruchom SQL z docs/SQL_BLOCKED_INGREDIENTS.sql w Supabase.`;
  }
  return base;
}

export default function PreferencesPage() {
  const supabase = createClient();
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [busyIds, setBusyIds] = useState<Set<number>>(new Set());

  const [userId, setUserId] = useState<string | null>(null);

  const [prefs, setPrefs] = useState<Map<number, Pref>>(new Map());
  const [recipesById, setRecipesById] = useState<Map<number, Recipe>>(new Map());

  const [filter, setFilter] = useState<"all" | Pref>("all");
  const [q, setQ] = useState("");

  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [blockedIngredientIds, setBlockedIngredientIds] = useState<Set<number>>(new Set());
  const [blockedQuery, setBlockedQuery] = useState("");
  const [blockedSuggestOpen, setBlockedSuggestOpen] = useState(false);
  const [blockedSelectedId, setBlockedSelectedId] = useState<number | null>(null);
  const [blockedLoadError, setBlockedLoadError] = useState<string | null>(null);
  const [blockedActionError, setBlockedActionError] = useState<string | null>(null);
  const [blockedNotice, setBlockedNotice] = useState<string | null>(null);
  const [blockedAddBusy, setBlockedAddBusy] = useState(false);
  const [blockedRemoveIds, setBlockedRemoveIds] = useState<Set<number>>(new Set());

  useEffect(() => {
    (async () => {
      setLoading(true);
      setBlockedLoadError(null);
      setBlockedActionError(null);

      const { data: userData, error: userErr } = await supabase.auth.getUser();
      if (userErr) logSupabaseError("auth.getUser", userErr);
      if (!userData.user) {
        router.push("/login");
        return;
      }
      const uid = userData.user.id;
      setUserId(uid);

      const [
        { data: p, error: pErr },
        { data: ing, error: ingErr },
        { data: blocked, error: blockedErr },
      ] = await Promise.all([
        supabase.from("user_recipe_preferences").select("recipe_id,preference"),
        supabase.from("ingredients").select("id,name,unit,category").order("name"),
        supabase
          .from("user_blocked_ingredients")
          .select("ingredient_id")
          .eq("user_id", uid),
      ]);

      if (pErr) logSupabaseError("load user_recipe_preferences", pErr);
      if (ingErr) logSupabaseError("load ingredients", ingErr);
      if (blockedErr) {
        logSupabaseError("load user_blocked_ingredients", blockedErr);
        setBlockedLoadError(formatBlockedLoadError(blockedErr));
      } else {
        setBlockedLoadError(null);
      }

      const prefMap = new Map<number, Pref>();
      const ids: number[] = [];
      for (const row of (p ?? []) as PrefRow[]) {
        prefMap.set(Number(row.recipe_id), row.preference);
        ids.push(Number(row.recipe_id));
      }
      setPrefs(prefMap);
      setIngredients((ing ?? []) as Ingredient[]);
      setBlockedIngredientIds(
        blockedErr
          ? new Set()
          : new Set((blocked ?? []).map((row) => Number((row as BlockedIngredientRow).ingredient_id)))
      );

      // 2) przepisy do tych ID
      if (ids.length > 0) {
        const { data: r, error: rErr } = await supabase
          .from("recipes")
          .select("id,name,meal_type")
          .in("id", ids);

        if (rErr) console.error(rErr);

        const rMap = new Map<number, Recipe>();
        for (const rec of (r ?? []) as Recipe[]) rMap.set(rec.id, rec);
        setRecipesById(rMap);
      } else {
        setRecipesById(new Map());
      }

      setLoading(false);
    })();
  }, [supabase, router]);

  const ingredientsById = useMemo(() => {
    const m = new Map<number, Ingredient>();
    for (const ing of ingredients) m.set(ing.id, ing);
    return m;
  }, [ingredients]);

  const blockedSuggestions = useMemo(() => {
    const qq = blockedQuery.trim().toLowerCase();
    if (qq.length < 2) return [];
    return ingredients
      .filter((ing) => !blockedIngredientIds.has(ing.id))
      .filter((ing) => ing.name.toLowerCase().includes(qq))
      .slice(0, 10);
  }, [blockedQuery, ingredients, blockedIngredientIds]);

  const blockedItems = useMemo(() => {
    const items = [...blockedIngredientIds].map((id) => {
      const ing = ingredientsById.get(id);
      return (
        ing ?? {
          id,
          name: `#${id}`,
          unit: "",
          category: null,
        }
      );
    });
    items.sort((a, b) => a.name.localeCompare(b.name));
    return items;
  }, [blockedIngredientIds, ingredientsById]);

  const blockedSelected = blockedSelectedId ? ingredientsById.get(blockedSelectedId) ?? null : null;

  const items: PrefItem[] = useMemo(() => {
    const out: PrefItem[] = [];
    for (const [recipe_id, preference] of prefs.entries()) {
      out.push({
        recipe_id,
        preference,
        recipe: recipesById.get(recipe_id),
      });
    }
    // sort: dislike na górze? zostawmy alfabetycznie po nazwie, z fallbackiem
    out.sort((a, b) => {
      const an = a.recipe?.name ?? `#${a.recipe_id}`;
      const bn = b.recipe?.name ?? `#${b.recipe_id}`;
      return an.localeCompare(bn);
    });
    return out;
  }, [prefs, recipesById]);

  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase();
    return items.filter((it) => {
      if (filter !== "all" && it.preference !== filter) return false;

      if (!qq) return true;
      const name = (it.recipe?.name ?? "").toLowerCase();
      const idStr = String(it.recipe_id);
      const mt = (it.recipe?.meal_type ?? "").toLowerCase();
      return name.includes(qq) || idStr.includes(qq) || mt.includes(qq);
    });
  }, [items, filter, q]);

  const counts = useMemo(() => {
    let fav = 0;
    let dis = 0;
    for (const p of prefs.values()) {
      if (p === "favorite") fav++;
      if (p === "dislike") dis++;
    }
    return { favorite: fav, dislike: dis, all: fav + dis };
  }, [prefs]);

  async function setPreference(recipeId: number, preference: Pref | null) {
    // optimistic UI
    setPrefs((prev) => {
      const next = new Map(prev);
      if (preference === null) next.delete(recipeId);
      else next.set(recipeId, preference);
      return next;
    });

    setBusyIds((prev) => new Set(prev).add(recipeId));

    try {
      if (preference === null) {
        const { error } = await supabase
          .from("user_recipe_preferences")
          .delete()
          .eq("recipe_id", recipeId);

        if (error) console.error(error);
        return;
      }

      const { error } = await supabase
        .from("user_recipe_preferences")
        .upsert({ recipe_id: recipeId, preference }, { onConflict: "user_id,recipe_id" });

      if (error) console.error(error);
    } finally {
      setBusyIds((prev) => {
        const next = new Set(prev);
        next.delete(recipeId);
        return next;
      });
    }
  }

  async function clearDislikes() {
    // szybka akcja: usuń wszystkie dislike
    const ids = [...prefs.entries()].filter(([, p]) => p === "dislike").map(([id]) => id);
    if (ids.length === 0) return;

    // optimistic
    setPrefs((prev) => {
      const next = new Map(prev);
      for (const id of ids) next.delete(id);
      return next;
    });

    const { error } = await supabase
      .from("user_recipe_preferences")
      .delete()
      .in("recipe_id", ids);

    if (error) console.error(error);
  }

  function pushBlockedNotice(message: string) {
    setBlockedNotice(message);
    window.setTimeout(() => setBlockedNotice(null), 2500);
  }

  function selectBlockedIngredient(ing: Ingredient) {
    setBlockedSelectedId(ing.id);
    setBlockedQuery(ing.name);
    setBlockedSuggestOpen(false);
    setBlockedActionError(null);
  }

  async function addBlockedIngredient() {
    if (!userId) {
      const msg = "Brak zalogowanego uzytkownika.";
      setBlockedActionError(msg);
      alert(msg);
      return;
    }
    if (blockedSelectedId === null) {
      const msg = "Wybierz produkt z listy.";
      setBlockedActionError(msg);
      alert(msg);
      return;
    }
    if (blockedIngredientIds.has(blockedSelectedId)) {
      pushBlockedNotice("Produkt jest juz na liscie blokad.");
      return;
    }

    setBlockedAddBusy(true);
    setBlockedActionError(null);
    try {
      const { error } = await supabase.from("user_blocked_ingredients").upsert(
        { user_id: userId, ingredient_id: blockedSelectedId },
        { onConflict: "user_id,ingredient_id" }
      );

      if (error) {
        logSupabaseError("user_blocked_ingredients insert error", error);
        const msg = error.message ?? "Nie udalo sie dodac blokady produktu.";
        setBlockedActionError(msg);
        alert(msg);
        return;
      }

      setBlockedIngredientIds((prev) => {
        const next = new Set(prev);
        next.add(blockedSelectedId);
        return next;
      });
      setBlockedSelectedId(null);
      setBlockedQuery("");
      pushBlockedNotice("Dodano do blokady.");
    } finally {
      setBlockedAddBusy(false);
    }
  }

  async function removeBlockedIngredient(ingredientId: number) {
    if (!userId) {
      const msg = "Brak zalogowanego uzytkownika.";
      setBlockedActionError(msg);
      alert(msg);
      return;
    }

    setBlockedActionError(null);
    setBlockedRemoveIds((prev) => new Set(prev).add(ingredientId));
    try {
      const { error } = await supabase
        .from("user_blocked_ingredients")
        .delete()
        .eq("user_id", userId)
        .eq("ingredient_id", ingredientId);

      if (error) {
        logSupabaseError("user_blocked_ingredients delete error", error);
        const msg = error.message ?? "Nie udalo sie usunac blokady produktu.";
        setBlockedActionError(msg);
        alert(msg);
        return;
      }

      setBlockedIngredientIds((prev) => {
        const next = new Set(prev);
        next.delete(ingredientId);
        return next;
      });
      pushBlockedNotice("Usunieto blokade.");
    } finally {
      setBlockedRemoveIds((prev) => {
        const next = new Set(prev);
        next.delete(ingredientId);
        return next;
      });
    }
  }

  if (loading) {
    return (
      <main className="card">
        <p className="text-sm text-slate-600">Ładowanie…</p>
      </main>
    );
  }

  return (
    <main className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold text-slate-900">Preferencje przepisów</h1>
        <p className="text-sm text-slate-600">
          Tu cofasz 🚫 i zarządzasz ⭐. Generator i „Zamień” w jadłospisie biorą to pod uwagę.
        </p>
      </header>

      <section className="card space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => setFilter("all")} disabled={filter === "all"} className="btn btn-secondary text-xs">
            Wszystkie ({counts.all})
          </button>
          <button
            onClick={() => setFilter("favorite")}
            disabled={filter === "favorite"}
            className="btn btn-secondary text-xs"
          >
            ⭐ Ulubione ({counts.favorite})
          </button>
          <button
            onClick={() => setFilter("dislike")}
            disabled={filter === "dislike"}
            className="btn btn-secondary text-xs"
          >
            🚫 Blacklista ({counts.dislike})
          </button>
          <div className="flex-1" />
          <input
            placeholder="Szukaj po nazwie / ID / typie (breakfast/lunch/dinner)"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="input min-w-[220px]"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
          <button onClick={clearDislikes} disabled={counts.dislike === 0} className="btn btn-secondary text-xs">
            Usuń całą blacklistę 🚫
          </button>
          <span>Tip: w jadłospisie swipe w prawo dodaje 🚫 i od razu podmienia przepis.</span>
        </div>
      </section>

      {/* Manual test: zablokuj "mleko", wygeneruj plan i sprawdź brak przepisów z mlekiem; potem usuń blokadę. */}
      <section className="card space-y-3">
        <div>
          <h2 className="section-title">Zablokowane produkty</h2>
          <p className="text-xs text-slate-500">
            Produkty na tej liście wykluczają przepisy z generatora jadłospisu i zamiany swipe.
          </p>
        </div>

        {blockedLoadError && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
            <b>Błąd wczytywania blokad:</b> {blockedLoadError}
          </div>
        )}
        {blockedActionError && (
          <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">
            <b>Błąd akcji:</b> {blockedActionError}
          </div>
        )}
        {blockedNotice && <div className="text-xs text-emerald-700">{blockedNotice}</div>}

        <div className="relative">
          <label className="block text-sm font-semibold text-slate-700">Dodaj produkt do blokady (autocomplete)</label>
          <input
            value={blockedQuery}
            onChange={(e) => {
              setBlockedQuery(e.target.value);
              setBlockedSelectedId(null);
              setBlockedSuggestOpen(true);
              setBlockedActionError(null);
            }}
            onFocus={() => setBlockedSuggestOpen(true)}
            onBlur={() => setTimeout(() => setBlockedSuggestOpen(false), 150)}
            placeholder="Wpisz min. 2 litery, np. mleko"
            className="input mt-2"
          />

          {blockedSuggestOpen && blockedSuggestions.length > 0 && (
            <div className="absolute left-0 right-0 top-full z-40 mt-2 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg">
              {blockedSuggestions.map((ing) => (
                <button
                  key={ing.id}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => selectBlockedIngredient(ing)}
                  className="w-full border-b border-slate-100 px-3 py-2 text-left hover:bg-slate-50"
                  title={`Dodaj #${ing.id}`}
                >
                  <div className="font-semibold text-slate-900">{ing.name}</div>
                  <div className="text-xs text-slate-500">
                    {ing.category ?? "bez kategorii"} • jednostka: {ing.unit} • ID: {ing.id}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={addBlockedIngredient}
            disabled={
              blockedSelectedId === null ||
              blockedAddBusy ||
              (blockedSelectedId !== null && blockedIngredientIds.has(blockedSelectedId))
            }
            className="btn btn-primary"
          >
            {blockedAddBusy ? "Dodaję..." : "Dodaj do blokady"}
          </button>
          {blockedSelected && (
            <span className="text-xs text-slate-500">
              Wybrano: {blockedSelected.name} (ID: {blockedSelected.id})
            </span>
          )}
          {blockedSelectedId === null && blockedQuery.trim().length > 0 && (
            <span className="text-xs text-slate-500">Wybierz produkt z listy.</span>
          )}
        </div>

        <div className="space-y-2">
          {blockedItems.length === 0 ? (
            <p className="text-sm text-slate-500">Brak zablokowanych produktów.</p>
          ) : (
            blockedItems.map((ing) => (
              <div
                key={ing.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3"
              >
                <div>
                  <div className="font-semibold text-slate-900">{ing.name}</div>
                  <div className="text-xs text-slate-500">
                    {ing.category ?? "bez kategorii"} • jednostka: {ing.unit || "-"} • ID: {ing.id}
                  </div>
                </div>
                <button
                  onClick={() => removeBlockedIngredient(ing.id)}
                  disabled={blockedRemoveIds.has(ing.id)}
                  className="btn btn-secondary text-xs"
                >
                  {blockedRemoveIds.has(ing.id) ? "Usuwam..." : "Usuń"}
                </button>
              </div>
            ))
          )}
        </div>
      </section>

      <section className="space-y-3">
        {filtered.length === 0 ? (
          <p className="text-sm text-slate-500">Brak wyników.</p>
        ) : (
          <div className="grid gap-3">
            {filtered.map((it) => {
              const rec = it.recipe;
              const name = rec?.name ?? `Przepis #${it.recipe_id}`;
              const mt = rec?.meal_type ?? "-";
              const busy = busyIds.has(it.recipe_id);

              return (
                <div key={it.recipe_id} className="card">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="font-semibold text-slate-900">
                        {name} <span className="text-xs text-slate-400">#{it.recipe_id}</span>
                      </div>
                      <div className="text-xs text-slate-500">
                        typ: <b className="text-slate-900">{mt}</b> • status:{" "}
                        <b className="text-slate-900">
                          {it.preference === "favorite" ? "⭐ ulubione" : "🚫 blacklista"}
                        </b>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        disabled={busy}
                        onClick={() =>
                          setPreference(it.recipe_id, it.preference === "favorite" ? null : "favorite")
                        }
                        title="Ustaw/usuń ulubione"
                        className="btn btn-secondary text-xs"
                      >
                        {it.preference === "favorite" ? "⭐ Usuń" : "☆ Ulubione"}
                      </button>

                      <button
                        disabled={busy}
                        onClick={() =>
                          setPreference(it.recipe_id, it.preference === "dislike" ? null : "dislike")
                        }
                        title="Ustaw/usuń blacklistę"
                        className="btn btn-secondary text-xs"
                      >
                        {it.preference === "dislike" ? "🚫 Cofnij" : "🚫 Blacklista"}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}
