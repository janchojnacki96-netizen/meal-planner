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
    <main style={{ maxWidth: 820, margin: "20px auto", padding: 16 }}>
      <header style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700 }}>Pantry â€” Mam w domu</h1>
          <p style={{ opacity: 0.8 }}>
            Dodaj produkty do pantry i edytuj ich ilosc. Wyswietlamy tylko produkty juz dodane.
          </p>
        </div>
        <button onClick={signOut}>Wyloguj</button>
      </header>
      <section style={{ marginTop: 12, border: "1px solid #ddd", borderRadius: 12, padding: 12 }}>
        <div style={{ fontWeight: 700 }}>Dodaj produkt</div>
        <div style={{ position: "relative", marginTop: 8 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <input
              placeholder="Wpisz nazwe produktu..."
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setSelectedIngredientId(null);
                setSuggestOpen(true);
                setAddMsg(null);
              }}
              onFocus={() => setSuggestOpen(true)}
              onBlur={() => setTimeout(() => setSuggestOpen(false), 150)}
              style={{ flex: 1, minWidth: 220, padding: 10 }}
            />
            <button
              type="button"
              onClick={clearSearch}
              disabled={!query && selectedIngredientId === null}
              style={{ padding: "8px 12px" }}
            >
              X
            </button>
            <button
              type="button"
              onClick={addSelectedIngredient}
              disabled={selectedIngredientId === null || addBusy}
              style={{ padding: "8px 12px" }}
            >
              Dodaj
            </button>
          </div>

          {suggestOpen && suggestions.length > 0 && (
            <div
              style={{
                position: "absolute",
                zIndex: 10,
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
              {suggestions.map((ing) => (
                <button
                  key={ing.id}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => selectSuggestion(ing)}
                  style={{
                    width: "100%",
                    textAlign: "left",
                    padding: 10,
                    border: "none",
                    background: "white",
                    cursor: "pointer",
                    borderBottom: "1px solid #eee",
                  }}
                >
                  <div style={{ fontWeight: 700 }}>{ing.name}</div>
                  <div style={{ opacity: 0.7, fontSize: 12 }}>
                    #{ing.id} - unit: {ing.unit}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
        {addMsg && <div style={{ marginTop: 8, fontSize: 12, opacity: 0.8 }}>{addMsg}</div>}
      </section>

      {loading ? (
        <p style={{ marginTop: 16 }}>Ladowanie...</p>
      ) : pantryItems.length === 0 ? (
        <p style={{ marginTop: 16, opacity: 0.8 }}>Brak produktow w pantry. Dodaj pierwszy produkt powyzej.</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, marginTop: 12, display: "grid", gap: 8 }}>
          {pantryItems.map((item) => {
            const ing = item.ingredient;
            const qty = item.quantity;
            const disabled = busyIds.has(ing.id);

            return (
              <li
                key={ing.id}
                style={{
                  border: "1px solid #ddd",
                  borderRadius: 10,
                  padding: 10,
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 10,
                }}
              >
                <div>
                  <div style={{ fontWeight: 600 }}>
                    {ing.name} <span style={{ opacity: 0.6 }}>#{ing.id}</span>
                  </div>
                  <div style={{ opacity: 0.75, fontSize: 13 }}>
                    {ing.category ?? ""} - unit: {ing.unit}
                  </div>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <input
                      type="number"
                      min={0}
                      placeholder="ilosc"
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
                      style={{ width: 90, padding: 6 }}
                    />
                    <span style={{ opacity: 0.8 }}>{ing.unit}</span>
                  </div>

                  <button onClick={() => removeFromPantry(ing.id)} disabled={disabled}>
                    Usun
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}</main>
  );
}



