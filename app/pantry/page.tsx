"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";

type Ingredient = {
  id: number;
  name: string;
  unit: string;
  category: string | null;
};

type PantryRow = {
  ingredient_id: number;
  quantity: number | null;
};

export default function PantryPage() {
  const supabase = createClient();
  const router = useRouter();

  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [pantry, setPantry] = useState<Map<number, PantryRow>>(new Map());
  const [userId, setUserId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [selectedIngredientId, setSelectedIngredientId] = useState<number | null>(null);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [addMsg, setAddMsg] = useState<string | null>(null);
  const [addBusy, setAddBusy] = useState(false);
  const [busyIds, setBusyIds] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);

      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) {
        router.push("/login");
        return;
      }
      setUserId(userData.user.id);

      const [{ data: ing, error: ingErr }, { data: pan, error: panErr }] =
        await Promise.all([
          supabase.from("ingredients").select("id,name,unit,category").order("name"),
          supabase.from("user_pantry").select("ingredient_id,quantity"),
        ]);

      if (ingErr) console.error(ingErr);
      if (panErr) console.error(panErr);

      setIngredients((ing ?? []) as Ingredient[]);
      setPantry(new Map((pan ?? []).map((r) => [r.ingredient_id, r as PantryRow])));

      setLoading(false);
    })();
  }, [supabase, router]);

  const ingredientsById = useMemo(() => {
    const m = new Map<number, Ingredient>();
    for (const i of ingredients) m.set(i.id, i);
    return m;
  }, [ingredients]);

  const suggestions = useMemo(() => {
    const qq = query.trim().toLowerCase();
    if (!qq) return [];
    return ingredients
      .filter((i) => i.name.toLowerCase().includes(qq))
      .slice(0, 10);
  }, [ingredients, query]);

  const pantryItems = useMemo(() => {
    const items: Array<{ ingredient: Ingredient; quantity: number | null }> = [];
    for (const row of pantry.values()) {
      const ing = ingredientsById.get(row.ingredient_id);
      if (!ing) continue;
      items.push({ ingredient: ing, quantity: row.quantity });
    }
    items.sort((a, b) => a.ingredient.name.localeCompare(b.ingredient.name));
    return items;
  }, [pantry, ingredientsById]);

  function clearSearch() {
    setQuery("");
    setSelectedIngredientId(null);
    setSuggestOpen(false);
    setAddMsg(null);
  }

  function selectSuggestion(ing: Ingredient) {
    setSelectedIngredientId(ing.id);
    setQuery(ing.name);
    setSuggestOpen(false);
    setAddMsg(null);
  }

  async function addSelectedIngredient() {
    if (!userId || selectedIngredientId === null) return;

    setAddMsg(null);

    if (pantry.has(selectedIngredientId)) {
      setAddMsg("Juz w pantry.");
      return;
    }

    setAddBusy(true);
    try {
      const { error } = await supabase.from("user_pantry").insert({
        user_id: userId,
        ingredient_id: selectedIngredientId,
        quantity: 1,
      });

      if (error) {
        console.error(error);
        setAddMsg("Nie udalo sie dodac produktu.");
        return;
      }

      setPantry((prev) => {
        const next = new Map(prev);
        next.set(selectedIngredientId, { ingredient_id: selectedIngredientId, quantity: 1 });
        return next;
      });

      clearSearch();
    } finally {
      setAddBusy(false);
    }
  }

  async function removeFromPantry(ingredientId: number) {
    if (!userId) return;

    setBusyIds((prev) => new Set(prev).add(ingredientId));
    try {
      const { error } = await supabase
        .from("user_pantry")
        .delete()
        .eq("user_id", userId)
        .eq("ingredient_id", ingredientId);

      if (error) {
        console.error(error);
        return;
      }

      setPantry((prev) => {
        const next = new Map(prev);
        next.delete(ingredientId);
        return next;
      });
    } finally {
      setBusyIds((prev) => {
        const next = new Set(prev);
        next.delete(ingredientId);
        return next;
      });
    }
  }

  async function saveQuantity(ingredientId: number, raw: string) {
    if (!userId) return;

    const trimmed = raw.trim();
    // Empty input -> null (treat as "have" without quantity).

    let qty: number | null = null;
    if (trimmed !== "") {
      const n = Number(trimmed.replace(",", "."));
      if (!Number.isFinite(n) || n < 0) return;
      qty = n;
    }

    if (!pantry.has(ingredientId)) return;

    setBusyIds((prev) => new Set(prev).add(ingredientId));
    try {
      const { error } = await supabase
        .from("user_pantry")
        .update({ quantity: qty })
        .eq("user_id", userId)
        .eq("ingredient_id", ingredientId);

      if (error) {
        console.error(error);
        return;
      }

      setPantry((prev) => {
        const next = new Map(prev);
        next.set(ingredientId, { ingredient_id: ingredientId, quantity: qty });
        return next;
      });
    } finally {
      setBusyIds((prev) => {
        const next = new Set(prev);
        next.delete(ingredientId);
        return next;
      });
    }
  }

  async function signOut() {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <main className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Pantry</h1>
          <p className="text-sm text-slate-600">
            Dodaj produkty do pantry i edytuj ich ilość. Wyświetlamy tylko produkty już dodane.
          </p>
        </div>
        <button onClick={signOut} className="btn btn-secondary">
          Wyloguj
        </button>
      </header>

      <section className="card space-y-3">
        <div className="section-title">Dodaj produkt</div>
        <div className="relative">
          <div className="flex flex-wrap items-center gap-2">
            <input
              placeholder="Wpisz nazwę produktu..."
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setSelectedIngredientId(null);
                setSuggestOpen(true);
                setAddMsg(null);
              }}
              onFocus={() => setSuggestOpen(true)}
              onBlur={() => setTimeout(() => setSuggestOpen(false), 150)}
              className="input flex-1"
            />
            <button
              type="button"
              onClick={clearSearch}
              disabled={!query && selectedIngredientId === null}
              className="btn btn-secondary"
            >
              Wyczyść
            </button>
            <button
              type="button"
              onClick={addSelectedIngredient}
              disabled={selectedIngredientId === null || addBusy}
              className="btn btn-primary"
            >
              Dodaj
            </button>
          </div>

          {suggestOpen && suggestions.length > 0 && (
            <div className="absolute left-0 right-0 top-full z-20 mt-2 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg">
              {suggestions.map((ing) => (
                <button
                  key={ing.id}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => selectSuggestion(ing)}
                  className="w-full border-b border-slate-100 px-3 py-2 text-left hover:bg-slate-50"
                >
                  <div className="font-semibold text-slate-900">{ing.name}</div>
                  <div className="text-xs text-slate-500">#{ing.id} • jednostka: {ing.unit}</div>
                </button>
              ))}
            </div>
          )}
        </div>
        {addMsg && <div className="text-xs text-slate-500">{addMsg}</div>}
      </section>

      {loading ? (
        <p className="text-sm text-slate-500">Ładowanie...</p>
      ) : pantryItems.length === 0 ? (
        <p className="text-sm text-slate-500">Brak produktów w pantry. Dodaj pierwszy produkt powyżej.</p>
      ) : (
        <ul className="grid gap-3">
          {pantryItems.map((item) => {
            const ing = item.ingredient;
            const qty = item.quantity;
            const disabled = busyIds.has(ing.id);

            return (
              <li key={ing.id} className="card flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="space-y-1">
                  <div className="font-semibold text-slate-900">
                    {ing.name} <span className="text-xs text-slate-400">#{ing.id}</span>
                  </div>
                  <div className="text-xs text-slate-500">{ing.category ?? ""} • jednostka: {ing.unit}</div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="number"
                    min={0}
                    placeholder="ilość"
                    value={qty === null ? "" : String(qty)}
                    disabled={disabled}
                    onChange={(e) => {
                      const v = e.target.value;

                      setPantry((prev) => {
                        const next = new Map(prev);
                        if (!next.has(ing.id)) return next;

                        if (v.trim() === "") {
                          next.set(ing.id, { ingredient_id: ing.id, quantity: null });
                          return next;
                        }

                        const n = Number(v.replace(",", "."));
                        if (!Number.isFinite(n) || n < 0) return next;

                        next.set(ing.id, { ingredient_id: ing.id, quantity: n });
                        return next;
                      });
                    }}
                    onBlur={(e) => saveQuantity(ing.id, e.target.value)}
                    className="input w-full sm:w-28"
                  />
                  <span className="text-xs text-slate-500">{ing.unit}</span>
                  <button onClick={() => removeFromPantry(ing.id)} disabled={disabled} className="btn btn-secondary text-xs">
                    Usuń
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
