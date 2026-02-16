"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
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
      <main style={{ maxWidth: 980, margin: "20px auto", padding: 16 }}>
        <p>Ładowanie…</p>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 980, margin: "20px auto", padding: 16 }}>
      <header style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800 }}>Preferencje przepisów</h1>
          <p style={{ opacity: 0.8, marginTop: 6 }}>
            Tu cofasz 🚫 i zarządzasz ⭐. Generator i “Zamień” w jadłospisie biorą to pod uwagę.
          </p>
        </div>

        <nav style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <Link href="/meal-plan">Jadłospis</Link>
          <Link href="/shopping-list">Zakupy</Link>
          <Link href="/recipes">Przepisy</Link>
          <Link href="/pantry">Pantry</Link>
        </nav>
      </header>

      <section style={{ marginTop: 12, border: "1px solid #ddd", borderRadius: 12, padding: 12 }}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <button onClick={() => setFilter("all")} disabled={filter === "all"}>
            Wszystkie ({counts.all})
          </button>
          <button onClick={() => setFilter("favorite")} disabled={filter === "favorite"}>
            ⭐ Ulubione ({counts.favorite})
          </button>
          <button onClick={() => setFilter("dislike")} disabled={filter === "dislike"}>
            🚫 Blacklista ({counts.dislike})
          </button>

          <div style={{ flex: 1 }} />

          <input
            placeholder="Szukaj po nazwie / ID / typie (breakfast/lunch/dinner)"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            style={{ padding: 10, minWidth: 280, maxWidth: 420, width: "100%" }}
          />
        </div>

        <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button onClick={clearDislikes} disabled={counts.dislike === 0}>
            Usuń całą blacklistę 🚫
          </button>
          <span style={{ opacity: 0.75, fontSize: 13 }}>
            Tip: w jadłospisie swipe w prawo dodaje 🚫 i od razu podmienia przepis.
          </span>
        </div>
      </section>

      {/* Manual test: zablokuj "mleko", wygeneruj plan i sprawdź brak przepisów z mlekiem; potem usuń blokadę. */}
      <section style={{ marginTop: 12, border: "1px solid #ddd", borderRadius: 12, padding: 12 }}>
        <h2 style={{ fontSize: 16, fontWeight: 700 }}>Zablokowane produkty</h2>
        <p style={{ opacity: 0.75, marginTop: 6, fontSize: 13 }}>
          Produkty na tej liście wykluczają przepisy z generatora jadłospisu i zamiany swipe.
        </p>
        {blockedLoadError && (
          <div
            style={{
              marginTop: 8,
              border: "1px solid #f2c94c",
              borderRadius: 10,
              padding: 10,
              background: "#fff9db",
              fontSize: 13,
            }}
          >
            <b>Blad wczytywania blokad:</b> {blockedLoadError}
          </div>
        )}
        {blockedActionError && (
          <div
            style={{
              marginTop: 8,
              border: "1px solid #fecaca",
              borderRadius: 10,
              padding: 10,
              background: "#fef2f2",
              fontSize: 13,
            }}
          >
            <b>Blad akcji:</b> {blockedActionError}
          </div>
        )}
        {blockedNotice && (
          <div style={{ marginTop: 8, fontSize: 13, color: "#065f46" }}>{blockedNotice}</div>
        )}

        <div style={{ position: "relative", marginTop: 10 }}>
          <label style={{ display: "block", marginBottom: 6, fontWeight: 700 }}>
            Dodaj produkt do blokady (autocomplete)
          </label>
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
            style={{ padding: 10, width: "100%" }}
          />

          {blockedSuggestOpen && blockedSuggestions.length > 0 && (
            <div
              style={{
                position: "absolute",
                zIndex: 40,
                left: 0,
                right: 0,
                top: "100%",
                marginTop: 6,
                border: "1px solid #ddd",
                borderRadius: 10,
                background: "white",
                overflow: "hidden",
              }}
            >
              {blockedSuggestions.map((ing) => (
                <button
                  key={ing.id}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => selectBlockedIngredient(ing)}
                  style={{
                    width: "100%",
                    textAlign: "left",
                    padding: 10,
                    border: "none",
                    background: "white",
                    cursor: "pointer",
                    borderBottom: "1px solid #eee",
                  }}
                  title={`Dodaj #${ing.id}`}
                >
                  <div style={{ fontWeight: 700 }}>{ing.name}</div>
                  <div style={{ opacity: 0.7, fontSize: 12 }}>
                    {ing.category ?? "bez kategorii"} - jednostka: {ing.unit} - ID: {ing.id}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <button
            onClick={addBlockedIngredient}
            disabled={
              blockedSelectedId === null ||
              blockedAddBusy ||
              (blockedSelectedId !== null && blockedIngredientIds.has(blockedSelectedId))
            }
          >
            {blockedAddBusy ? "Dodaje..." : "Dodaj do blokady"}
          </button>
          {blockedSelected && (
            <span style={{ opacity: 0.75, fontSize: 12 }}>
              Wybrano: {blockedSelected.name} (ID: {blockedSelected.id})
            </span>
          )}
          {blockedSelectedId === null && blockedQuery.trim().length > 0 && (
            <span style={{ opacity: 0.75, fontSize: 12 }}>Wybierz produkt z listy.</span>
          )}
        </div>

        <div style={{ marginTop: 12 }}>
          {blockedItems.length === 0 ? (
            <p style={{ opacity: 0.75, margin: 0 }}>Brak zablokowanych produktów.</p>
          ) : (
            <div style={{ display: "grid", gap: 8 }}>
              {blockedItems.map((ing) => (
                <div
                  key={ing.id}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: 10,
                    borderTop: "1px solid #eee",
                    paddingTop: 10,
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 700 }}>{ing.name}</div>
                    <div style={{ opacity: 0.7, fontSize: 12 }}>
                      {ing.category ?? "bez kategorii"} - jednostka: {ing.unit || "-"} - ID: {ing.id}
                    </div>
                  </div>
                  <button
                    onClick={() => removeBlockedIngredient(ing.id)}
                    disabled={blockedRemoveIds.has(ing.id)}
                  >
                    {blockedRemoveIds.has(ing.id) ? "Usuwam..." : "Usuń"}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      <section style={{ marginTop: 16 }}>
        {filtered.length === 0 ? (
          <p style={{ opacity: 0.85 }}>Brak wyników.</p>
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            {filtered.map((it) => {
              const rec = it.recipe;
              const name = rec?.name ?? `Przepis #${it.recipe_id}`;
              const mt = rec?.meal_type ?? "-";
              const busy = busyIds.has(it.recipe_id);

              return (
                <div
                  key={it.recipe_id}
                  style={{ border: "1px solid #ddd", borderRadius: 12, padding: 12 }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                    <div>
                      <div style={{ fontWeight: 800 }}>
                        {name} <span style={{ opacity: 0.6 }}>#{it.recipe_id}</span>
                      </div>
                      <div style={{ opacity: 0.8, fontSize: 13 }}>
                        typ: <b>{mt}</b> • status:{" "}
                        <b>{it.preference === "favorite" ? "⭐ ulubione" : "🚫 blacklista"}</b>
                      </div>
                    </div>

                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      {/* toggle favorite */}
                      <button
                        disabled={busy}
                        onClick={() =>
                          setPreference(it.recipe_id, it.preference === "favorite" ? null : "favorite")
                        }
                        title="Ustaw/usuń ulubione"
                      >
                        {it.preference === "favorite" ? "⭐ Usuń" : "☆ Ulubione"}
                      </button>

                      {/* toggle dislike */}
                      <button
                        disabled={busy}
                        onClick={() =>
                          setPreference(it.recipe_id, it.preference === "dislike" ? null : "dislike")
                        }
                        title="Ustaw/usuń blacklistę"
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
