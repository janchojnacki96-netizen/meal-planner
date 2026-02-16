"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { buildPlanVersionMap, formatPlanLabel } from "@/lib/plans";

type MealType = "breakfast" | "lunch" | "dinner";

type MealPlan = {
  id: string;
  start_date: string;
  days_count: number;
  created_at: string;
};

type Slot = {
  id: string;
  meal_plan_id: string;
  date: string; // YYYY-MM-DD
  meal_type: MealType;
  recipe_id: number | null;
  servings: number; // 0 = resztki
};

type Recipe = {
  id: number;
  name: string;
  meal_type: MealType;
  base_servings: number;
};

type Ingredient = {
  id: number;
  name: string;
  unit: string;
  category: string | null;
};

type RecipeIngredient = {
  recipe_id: number;
  ingredient_id: number;
  amount: number | null;
  unit: string | null;
};

type PantryRow = {
  ingredient_id: number;
  quantity: number | null;
};

type ShoppingStateRow = {
  ingredient_id: number;
  purchased_qty: number | null;
  done: boolean;
};

type ExtraRow = {
  id: string;
  name: string;
  done: boolean;
  meal_plan_id: string | null;
};

type ComputedItem = {
  ingredient_id: number;
  name: string;
  category: string;
  unit: string;
  needed: number;
  pantryQty: number | null;
  toBuy: number;
};

function safeNumber(v: string): number | null {
  const t = v.trim().replace(",", ".");
  if (!t) return null;
  const n = Number(t);
  if (!Number.isFinite(n)) return null;
  return n;
}

function fmtQty(n: number): string {
  const s = (Math.round(n * 100) / 100).toFixed(2);
  return s.replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
}

function logSupabaseError(
  context: string,
  error: { message?: string; details?: string; hint?: string; code?: string } | null
) {
  if (!error) return;
  console.error(context, {
    message: error.message,
    details: error.details,
    hint: error.hint,
    code: error.code,
    raw: error,
  });
}

export default function ShoppingListPage() {
  const supabase = createClient();
  const router = useRouter();

  const [initialLoading, setInitialLoading] = useState(true);
  const [planLoading, setPlanLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [userId, setUserId] = useState<string | null>(null);

  const [busyIds, setBusyIds] = useState<Set<number>>(new Set());

  const [allPlans, setAllPlans] = useState<MealPlan[]>([]);
  const [selectedPlanIds, setSelectedPlanIds] = useState<Set<string>>(new Set());
  const [plan, setPlan] = useState<MealPlan | null>(null);
  const [slots, setSlots] = useState<Slot[]>([]);

  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [recipeIngredients, setRecipeIngredients] = useState<RecipeIngredient[]>([]);

  const [pantry, setPantry] = useState<Map<number, PantryRow>>(new Map());

  // stan odhaczania zakupów + ilości
  const [shoppingState, setShoppingState] = useState<Map<number, ShoppingStateRow>>(new Map());
  const [inputQty, setInputQty] = useState<Map<number, string>>(new Map());

  // extra (ręczne)
  const [extras, setExtras] = useState<ExtraRow[]>([]);
  const [extraName, setExtraName] = useState("");
  const [bulkTransferBusy, setBulkTransferBusy] = useState(false);
  const [bulkExtrasBusy, setBulkExtrasBusy] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<{ current: number; total: number } | null>(null);

  // UI
  const [hideZero, setHideZero] = useState(true);

  const loading = initialLoading || planLoading;
  const selectedPlanIdsArray = useMemo(() => Array.from(selectedPlanIds), [selectedPlanIds]);
  const planVersionById = useMemo(() => buildPlanVersionMap(allPlans), [allPlans]);

  function planLabel(pl: MealPlan): string {
    return formatPlanLabel(pl, planVersionById);
  }

  useEffect(() => {
    (async () => {
      setInitialLoading(true);
      setLoadError(null);

      const { data: userData, error: userErr } = await supabase.auth.getUser();
      if (userErr) console.error(userErr);

      if (!userData.user) {
        router.push("/login");
        return;
      }
      setUserId(userData.user.id);

      const { data: plans, error: plansErr } = await supabase
        .from("meal_plans")
        .select("id,start_date,days_count,created_at")
        .order("created_at", { ascending: false });

      if (plansErr) console.error(plansErr);

      const plansList = (plans ?? []) as MealPlan[];
      setAllPlans(plansList);

      const latestPlan = plansList[0] ?? null;
      setPlan(latestPlan);
      if (latestPlan) setSelectedPlanIds(new Set([latestPlan.id]));
      else setSelectedPlanIds(new Set());

      const { data: pan, error: panErr } = await supabase
        .from("user_pantry")
        .select("ingredient_id,quantity");
      if (panErr) console.error(panErr);

      const pMap = new Map<number, PantryRow>();
      for (const row of (pan ?? []) as PantryRow[]) pMap.set(row.ingredient_id, row);
      setPantry(pMap);

      if (latestPlan) {
        const { data: ex, error: exErr } = await supabase
          .from("user_shopping_extras")
          .select("id,name,done,meal_plan_id")
          .eq("meal_plan_id", latestPlan.id)
          .order("created_at", { ascending: false });

        if (exErr) console.error(exErr);
        setExtras((ex ?? []) as ExtraRow[]);
      } else {
        setExtras([]);
      }

      setInitialLoading(false);
    })();
  }, [supabase, router]);

  useEffect(() => {
    (async () => {
      if (!userId) return;

      const planIds = selectedPlanIdsArray;
      if (planIds.length === 0) {
        setSlots([]);
        setRecipes([]);
        setIngredients([]);
        setRecipeIngredients([]);
        setShoppingState(new Map());
        setInputQty(new Map());
        setLoadError(null);
        setPlanLoading(false);
        return;
      }

      setPlanLoading(true);
      setLoadError(null);

      try {
        const slotsQuery = supabase
          .from("meal_plan_slots")
          .select("id,meal_plan_id,date,meal_type,recipe_id,servings");

        const { data: s, error: sErr } =
          planIds.length === 1
            ? await slotsQuery.eq("meal_plan_id", planIds[0])
            : await slotsQuery.in("meal_plan_id", planIds);

        if (sErr) console.error(sErr);

        const slotsData = (s ?? []) as Slot[];
        setSlots(slotsData);

        const recipeIds = Array.from(
          new Set(slotsData.map((x) => x.recipe_id).filter((x): x is number => typeof x === "number"))
        );

        const emptyRecipes: Recipe[] = [];
        const emptyRecipeIngs: RecipeIngredient[] = [];

        const [{ data: r, error: rErr }, { data: ri, error: riErr }] = await Promise.all([
          recipeIds.length
            ? supabase.from("recipes").select("id,name,meal_type,base_servings").in("id", recipeIds)
            : Promise.resolve({ data: emptyRecipes, error: null }),
          recipeIds.length
            ? supabase
                .from("recipe_ingredients")
                .select("recipe_id,ingredient_id,amount,unit")
                .in("recipe_id", recipeIds)
            : Promise.resolve({ data: emptyRecipeIngs, error: null }),
        ]);

        if (rErr) console.error(rErr);
        if (riErr) console.error(riErr);

        const riData = (ri ?? []) as RecipeIngredient[];
        setRecipes((r ?? []) as Recipe[]);
        setRecipeIngredients(riData);

        const ingIds = Array.from(new Set(riData.map((x) => x.ingredient_id)));
        const emptyIngredients: Ingredient[] = [];
        const { data: ing, error: ingErr } = ingIds.length
          ? await supabase
              .from("ingredients")
              .select("id,name,unit,category")
              .in("id", ingIds)
              .order("category", { ascending: true })
              .order("name", { ascending: true })
          : { data: emptyIngredients, error: null };

        if (ingErr) console.error(ingErr);
        setIngredients((ing ?? []) as Ingredient[]);

        const stateQuery = supabase
          .from("user_shopping_state")
          .select("meal_plan_id,ingredient_id,purchased_qty,done");

        const { data: st, error: stErr } =
          planIds.length === 1
            ? await stateQuery.eq("meal_plan_id", planIds[0])
            : await stateQuery.in("meal_plan_id", planIds);

        if (stErr) console.error(stErr);

        type ShoppingStateDbRow = {
          meal_plan_id: string;
          ingredient_id: number;
          purchased_qty: number | null;
          done: boolean;
        };

        const doneByIngredient = new Map<number, Map<string, boolean>>();
        const qtyByIngredient = new Map<number, number>();
        const qtySeen = new Set<number>();

        for (const row of (st ?? []) as ShoppingStateDbRow[]) {
          const ingredientId = Number(row.ingredient_id);
          const planId = String(row.meal_plan_id);
          const planDone = Boolean(row.done);

          const planMap = doneByIngredient.get(ingredientId) ?? new Map<string, boolean>();
          planMap.set(planId, planDone);
          doneByIngredient.set(ingredientId, planMap);

          if (row.purchased_qty !== null) {
            const prev = qtyByIngredient.get(ingredientId) ?? 0;
            qtyByIngredient.set(ingredientId, prev + Number(row.purchased_qty));
            qtySeen.add(ingredientId);
          }
        }

        const stMap = new Map<number, ShoppingStateRow>();
        const qtyMap = new Map<number, string>();
        const ingredientIds = new Set<number>([...doneByIngredient.keys(), ...qtyByIngredient.keys()]);

        for (const ingredientId of ingredientIds) {
          const doneAll = planIds.every(
            (planId) => doneByIngredient.get(ingredientId)?.get(planId) === true
          );
          const purchasedSum = qtySeen.has(ingredientId) ? qtyByIngredient.get(ingredientId) ?? 0 : null;

          stMap.set(ingredientId, {
            ingredient_id: ingredientId,
            purchased_qty: purchasedSum,
            done: doneAll,
          });

          if (purchasedSum !== null) qtyMap.set(ingredientId, String(purchasedSum));
        }

        setShoppingState(stMap);
        setInputQty(qtyMap);

        if (slotsData.length > 0 && recipeIds.length > 0 && riData.length === 0) {
          setLoadError(
            "Wykryłem plan z przepisami, ale nie wczytały się powiązania recipe_ingredients. Sprawdź czy tabela recipe_ingredients ma kolumny: recipe_id, ingredient_id, amount, unit."
          );
        }
      } finally {
        setPlanLoading(false);
      }
    })();
  }, [supabase, userId, selectedPlanIdsArray]);

  const recipesById = useMemo(() => {
    const m = new Map<number, Recipe>();
    for (const r of recipes) m.set(r.id, r);
    return m;
  }, [recipes]);

  const ingredientsById = useMemo(() => {
    const m = new Map<number, Ingredient>();
    for (const i of ingredients) m.set(i.id, i);
    return m;
  }, [ingredients]);

  const recipeIngsByRecipeId = useMemo(() => {
    const m = new Map<number, RecipeIngredient[]>();
    for (const ri of recipeIngredients) {
      const arr = m.get(ri.recipe_id) ?? [];
      arr.push(ri);
      m.set(ri.recipe_id, arr);
    }
    return m;
  }, [recipeIngredients]);

  // policz potrzebne ilości na podstawie planu
  const computed = useMemo(() => {
    const totals = new Map<number, { needed: number; unit: string; name: string; category: string }>();

    for (const slot of slots) {
      if (!slot.recipe_id) continue;
      if (slot.servings <= 0) continue; // resztki nie liczymy

      const recipe = recipesById.get(slot.recipe_id);
      const base = recipe?.base_servings && recipe.base_servings > 0 ? recipe.base_servings : 1;
      const scale = slot.servings / base;

      const rows = recipeIngsByRecipeId.get(slot.recipe_id) ?? [];
      for (const row of rows) {
        const ing = ingredientsById.get(row.ingredient_id);
        if (!ing) continue;

        const q = (row.amount ?? 0) * scale;
        const unit = row.unit ?? ing.unit ?? "";
        const category = ing.category ?? "inne";

        const prev = totals.get(ing.id);
        if (!prev) totals.set(ing.id, { needed: q, unit, name: ing.name, category });
        else prev.needed += q;
      }
    }

    const items: ComputedItem[] = Array.from(totals.entries()).map(([ingredient_id, t]) => {
      const pantryRow = pantry.get(ingredient_id);
      const pantryQty = pantryRow?.quantity ?? null;

      const toBuy = pantryQty === null ? t.needed : Math.max(0, t.needed - pantryQty);

      return {
        ingredient_id,
        name: t.name,
        category: t.category,
        unit: t.unit,
        needed: t.needed,
        pantryQty,
        toBuy,
      };
    });

    items.sort((a, b) => a.name.localeCompare(b.name));

    const grouped = new Map<string, ComputedItem[]>();
    for (const it of items) {
      const cat = it.category || "inne";
      const arr = grouped.get(cat) ?? [];
      arr.push(it);
      grouped.set(cat, arr);
    }

    const categories = Array.from(grouped.keys()).sort((a, b) => a.localeCompare(b));
    return { categories, grouped };
  }, [slots, recipesById, recipeIngsByRecipeId, ingredientsById, pantry]);

  const computedItems = useMemo(() => {
    const items: ComputedItem[] = [];
    for (const cat of computed.categories) {
      const group = computed.grouped.get(cat) ?? [];
      items.push(...group);
    }
    return items;
  }, [computed]);

  const toBuyById = useMemo(() => {
    const map = new Map<number, number>();
    for (const item of computedItems) {
      map.set(item.ingredient_id, item.toBuy);
    }
    return map;
  }, [computedItems]);

  const bulkTransferLabel = bulkTransferBusy
    ? bulkProgress
      ? `Przenoszę... (${bulkProgress.current}/${bulkProgress.total})`
      : "Przenoszę..."
    : "Przenieś całą listę do pantry";
  const bulkExtrasLabel = bulkExtrasBusy ? "Usuwanie..." : "Usuń wszystkie dodatki";

  function getDone(ingredientId: number): boolean {
    return shoppingState.get(ingredientId)?.done ?? false;
  }

  function getQtyInput(ingredientId: number, fallback: number): string {
    const v = inputQty.get(ingredientId);
    if (v !== undefined) return v;
    return fallback > 0 ? fmtQty(fallback) : "";
  }

  async function upsertShoppingState(
    planId: string,
    ingredientId: number,
    done: boolean,
    purchasedQty: number | null
  ): Promise<boolean> {
    if (!userId) return false;

    const { error } = await supabase.from("user_shopping_state").upsert(
      {
        user_id: userId, // <-- KLUCZ FIX
        meal_plan_id: planId,
        ingredient_id: ingredientId,
        done,
        purchased_qty: purchasedQty,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,meal_plan_id,ingredient_id" }
    );

    if (error) {
      console.error("upsertShoppingState error", {
        message: error.message,
        details: error.details,
        hint: error.hint,
        code: error.code,
        raw: error,
      });
      return false;
    }

    return true;
  }

  async function addToPantry(ingredientId: number, transferQty: number): Promise<boolean> {
    if (!userId) return false;
    if (!Number.isFinite(transferQty) || transferQty <= 0) return false;

    const { data: existingRows, error: fetchErr } = await supabase
      .from("user_pantry")
      .select("ingredient_id,quantity")
      .eq("user_id", userId)
      .eq("ingredient_id", ingredientId)
      .limit(1);

    if (fetchErr) {
      logSupabaseError("addToPantry error", fetchErr);
      return false;
    }

    const existing = (existingRows ?? [])[0] as PantryRow | undefined;
    const existingQty = existing?.quantity ?? 0;
    const newQty = existingQty + transferQty;

    if (existing) {
      const { error: updateErr } = await supabase
        .from("user_pantry")
        .update({ quantity: newQty })
        .eq("user_id", userId)
        .eq("ingredient_id", ingredientId);
      if (updateErr) {
        logSupabaseError("addToPantry error", updateErr);
        return false;
      }
    } else {
      const { error: insertErr } = await supabase
        .from("user_pantry")
        .insert({ user_id: userId, ingredient_id: ingredientId, quantity: newQty });
      if (insertErr) {
        logSupabaseError("addToPantry error", insertErr);
        return false;
      }
    }

    setPantry((prev) => {
      const next = new Map(prev);
      next.set(ingredientId, { ingredient_id: ingredientId, quantity: newQty });
      return next;
    });

    return true;
  }

  async function toggleBoughtAndTransfer(
    ingredientId: number,
    done: boolean,
    purchasedQty: number | null
  ) {
    if (!userId) return;

    const planIds = selectedPlanIdsArray;
    if (planIds.length === 0) return;

    setBusyIds((prev) => new Set(prev).add(ingredientId));

    try {
      const transferQty = purchasedQty ?? (toBuyById.get(ingredientId) ?? 0);
      const perPlanQty = purchasedQty === null ? null : purchasedQty / planIds.length;
      const results = await Promise.all(
        planIds.map((planId) => upsertShoppingState(planId, ingredientId, done, perPlanQty))
      );
      if (results.some((ok) => !ok)) return;

      setShoppingState((prev) => {
        const next = new Map(prev);
        next.set(ingredientId, { ingredient_id: ingredientId, done, purchased_qty: purchasedQty });
        return next;
      });

      if (done && transferQty > 0) await addToPantry(ingredientId, transferQty);
    } finally {
      setBusyIds((prev) => {
        const next = new Set(prev);
        next.delete(ingredientId);
        return next;
      });
    }
  }

  async function addExtra() {
    if (!plan || !userId) return;
    const name = extraName.trim();
    if (!name) return;

    setExtraName("");

    const { data, error } = await supabase
      .from("user_shopping_extras")
      .insert({ user_id: userId, meal_plan_id: plan.id, name }) // <-- KLUCZ FIX
      .select("id,name,done,meal_plan_id")
      .single();

    if (error) {
      console.error(error);
      alert("Nie udało się dodać produktu (sprawdź RLS / tabelę user_shopping_extras).");
      return;
    }

    setExtras((prev) => [data as ExtraRow, ...prev]);
  }

  async function toggleExtraDone(extraId: string, done: boolean) {
    setExtras((prev) => prev.map((x) => (x.id === extraId ? { ...x, done } : x)));
    const { error } = await supabase.from("user_shopping_extras").update({ done }).eq("id", extraId);
    if (error) console.error(error);
  }

  async function deleteExtra(extraId: string) {
    setExtras((prev) => prev.filter((x) => x.id !== extraId));
    const { error } = await supabase.from("user_shopping_extras").delete().eq("id", extraId);
    if (error) console.error(error);
  }

  async function transferAllToPantry() {
    if (!userId) return;
    if (bulkTransferBusy) return;

    const itemsToTransfer = computedItems.filter((item) => item.toBuy > 0);
    if (itemsToTransfer.length === 0) return;
    if (!confirm("Na pewno przenieść całą listę do pantry?")) return;

    setBulkTransferBusy(true);
    setBulkProgress({ current: 0, total: itemsToTransfer.length });

    try {
      let current = 0;

      for (const item of itemsToTransfer) {
        const ok = await addToPantry(item.ingredient_id, item.toBuy);
        if (!ok) {
          alert("Nie udało się przenieść listy do pantry.");
          return;
        }

        current += 1;
        setBulkProgress({ current, total: itemsToTransfer.length });
      }

      if (extras.length > 0) {
        const shouldClearExtras = confirm("Na pewno usunąć wszystkie dodatkowe produkty?");
        if (shouldClearExtras) await deleteAllExtras(true);
      }
    } finally {
      setBulkTransferBusy(false);
      setBulkProgress(null);
    }
  }

  async function deleteAllExtras(skipConfirm = false): Promise<boolean> {
    if (!userId) return false;
    if (!skipConfirm && !confirm("Na pewno usunąć wszystkie dodatkowe produkty?")) return false;

    setBulkExtrasBusy(true);
    try {
      const { error } = await supabase.from("user_shopping_extras").delete().eq("user_id", userId);
      if (error) {
        console.error(error);
        alert(error.message ?? "Nie udało się usunąć dodatków.");
        return false;
      }
      setExtras([]);
      return true;
    } finally {
      setBulkExtrasBusy(false);
    }
  }

  if (loading) {
    return (
      <main style={{ maxWidth: 1200, margin: "20px auto", padding: 16 }}>
        <p>Ładowanie...</p>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 1200, margin: "20px auto", padding: 16 }}>
      <div style={{ display: "flex", gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
      <header style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800 }}>Lista zakupów</h1>
                    <p style={{ opacity: 0.8 }}>
            Wybrane plany: <b>{selectedPlanIds.size}</b>
          </p>
          {allPlans.length === 0 && (
            <p style={{ opacity: 0.8 }}>Brak planu - przejdź do jadłospisu i wygeneruj plan.</p>
          )}
        </div>
      </header>

      {loadError && (
        <section style={{ marginTop: 12, border: "1px solid #f2c94c", borderRadius: 12, padding: 12, background: "#fff9db" }}>
          <b>Uwaga:</b> {loadError}
        </section>
      )}

      <section style={{ marginTop: 12, border: "1px solid #ddd", borderRadius: 12, padding: 12 }}>
        <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input type="checkbox" checked={hideZero} onChange={(e) => setHideZero(e.target.checked)} />
          Ukryj produkty (do kupienia = 0)
        </label>
        <p style={{ marginTop: 8, opacity: 0.75, fontSize: 13 }}>
          Zaznaczenie jako kupione przenosi ilość do Pantry. Jeśli nie wpiszesz ilości, użyjemy wartości do kupienia.
        </p>
      </section>

      {/* LISTA Z BAZY */}
      <section style={{ marginTop: 16 }}>
        {selectedPlanIds.size === 0 ? (
          <p style={{ opacity: 0.85 }}>Zaznacz co najmniej 1 plan.</p>
        ) : computed.categories.length === 0 ? (
          <p style={{ opacity: 0.85 }}>
            Nic do pokazania. Spróbuj odznaczyć filtr Ukryj do kupienia = 0.
          </p>
        ) : (
          computed.categories.map((cat) => {
            const items = computed.grouped.get(cat) ?? [];
            const visible = hideZero ? items.filter((x) => x.toBuy > 0) : items;
            if (visible.length === 0) return null;

            return (
              <div key={cat} style={{ marginBottom: 16 }}>
                <h2 style={{ fontSize: 16, fontWeight: 800, marginBottom: 8 }}>{cat}</h2>

                <div style={{ border: "1px solid #ddd", borderRadius: 12, padding: 12 }}>
                  {visible.map((it) => {
                    const done = getDone(it.ingredient_id);
                    const disabled = busyIds.has(it.ingredient_id);

                    const qtyStr = getQtyInput(it.ingredient_id, it.toBuy);
                    const currentInput = inputQty.get(it.ingredient_id) ?? qtyStr;

                    const pantryFlag =
                      it.pantryQty === null
                        ? pantry.has(it.ingredient_id)
                          ? "oznaczone jako mam"
                          : "nie mam"
                        : `w pantry: ${fmtQty(it.pantryQty)} ${it.unit}`;

                    return (
                      <div key={it.ingredient_id} style={{ padding: "10px 0", borderTop: "1px solid #eee" }}>
                        <div style={{ display: "flex", gap: 12, alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap" }}>
                          <label style={{ display: "flex", gap: 10, alignItems: "flex-start", cursor: "pointer", flex: 1 }}>
                            <input
                              type="checkbox"
                              checked={done}
                              disabled={disabled}
                              onChange={(e) => {
                                const checked = e.target.checked;
                                const qty = safeNumber((inputQty.get(it.ingredient_id) ?? qtyStr) || "");
                                toggleBoughtAndTransfer(it.ingredient_id, checked, qty);
                              }}
                              style={{ marginTop: 4 }}
                            />
                            <div>
                              <div style={{ fontWeight: 800 }}>
                                {it.name} <span style={{ opacity: 0.6 }}>#{it.ingredient_id}</span>
                              </div>
                              <div style={{ opacity: 0.8, fontSize: 13, marginTop: 2 }}>
                                potrzebne: <b>{fmtQty(it.needed)}</b> {it.unit} - {pantryFlag}
                              </div>
                              <div style={{ opacity: 0.85, fontSize: 13, marginTop: 2 }}>
                                do kupienia: <b>{fmtQty(it.toBuy)}</b> {it.unit}
                              </div>
                            </div>
                          </label>

                          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                              <span style={{ opacity: 0.75, fontSize: 12 }}>Ilość do pantry</span>
                              <input
                                value={currentInput}
                                disabled={disabled}
                                onChange={(e) => {
                                  const v = e.target.value;
                                  setInputQty((prev) => {
                                    const next = new Map(prev);
                                    next.set(it.ingredient_id, v);
                                    return next;
                                  });
                                }}
                                placeholder={it.toBuy > 0 ? fmtQty(it.toBuy) : ""}
                                style={{ width: 140, padding: 8 }}
                              />
                            </div>

                            <button
                              disabled={disabled}
                              onClick={async () => {
                                setBusyIds((prev) => new Set(prev).add(it.ingredient_id));
                                try {
                                  const parsedQty = safeNumber(currentInput || "");
                                  const transferQty = parsedQty ?? it.toBuy;
                                  if (transferQty > 0) {
                                    await addToPantry(it.ingredient_id, transferQty);
                                  }
                                } finally {
                                  setBusyIds((prev) => {
                                    const next = new Set(prev);
                                    next.delete(it.ingredient_id);
                                    return next;
                                  });
                                }
                              }}
                              title="Przenieś do pantry (bez odhaczania)"
                            >
                              Do pantry
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })
        )}
      </section>

      {/* EXTRA / RĘCZNE */}
      <section style={{ marginTop: 22, border: "1px solid #ddd", borderRadius: 12, padding: 12 }}>
        <h2 style={{ fontSize: 16, fontWeight: 800, marginBottom: 8 }}>Dodatkowe zakupy (poza bazą)</h2>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <input
            value={extraName}
            onChange={(e) => setExtraName(e.target.value)}
            placeholder="np. papier toaletowy"
            style={{ padding: 10, minWidth: 260, flex: 1 }}
          />
          <button onClick={addExtra} disabled={!plan || !extraName.trim()}>
            Dodaj
          </button>
        </div>

        <div style={{ marginTop: 12 }}>
          {extras.length === 0 ? (
            <p style={{ opacity: 0.8, margin: 0 }}>Brak dodatkowych pozycji.</p>
          ) : (
            <div style={{ display: "grid", gap: 8 }}>
              {extras.map((x) => (
                <div
                  key={x.id}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 10,
                    alignItems: "center",
                    borderTop: "1px solid #eee",
                    paddingTop: 10,
                  }}
                >
                  <label style={{ display: "flex", gap: 10, alignItems: "center", cursor: "pointer", flex: 1 }}>
                    <input
                      type="checkbox"
                      checked={x.done}
                      onChange={(e) => toggleExtraDone(x.id, e.target.checked)}
                    />
                    <span style={{ fontWeight: 700 }}>{x.name}</span>
                  </label>

                  <button onClick={() => deleteExtra(x.id)} title="Usuń">
                    Usuń
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
      </div>

      <aside
        style={{
          width: 340,
          position: "sticky",
          top: 16,
          alignSelf: "flex-start",
          border: "1px solid #ddd",
          borderRadius: 12,
          padding: 12,
          background: "white",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10 }}>
          <h2 style={{ fontSize: 16, fontWeight: 800, margin: 0 }}>Moje jadłospisy</h2>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <button
              onClick={() => setSelectedPlanIds(new Set(allPlans.map((pl) => pl.id)))}
              disabled={allPlans.length === 0 || selectedPlanIds.size === allPlans.length}
              style={{ fontSize: 12, padding: "6px 8px" }}
            >
              Zaznacz wszystkie
            </button>
            <button
              onClick={() => setSelectedPlanIds(new Set())}
              disabled={selectedPlanIds.size === 0}
              style={{ fontSize: 12, padding: "6px 8px" }}
            >
              Wyczyść
            </button>
            <button
              onClick={transferAllToPantry}
              disabled={computedItems.length === 0 || bulkTransferBusy}
              style={{ fontSize: 12, padding: "6px 8px" }}
            >
              {bulkTransferLabel}
            </button>
            <button
              onClick={() => deleteAllExtras()}
              disabled={extras.length === 0 || bulkExtrasBusy}
              style={{ fontSize: 12, padding: "6px 8px" }}
            >
              {bulkExtrasLabel}
            </button>
          </div>
        </div>

        <div style={{ marginTop: 10, maxHeight: "70vh", overflowY: "auto", display: "grid", gap: 8 }}>
          {allPlans.length === 0 ? (
            <div style={{ opacity: 0.8 }}>Brak planów.</div>
          ) : (
            allPlans.map((pl) => {
              const checked = selectedPlanIds.has(pl.id);

              return (
                <label
                  key={pl.id}
                  style={{
                    display: "flex",
                    gap: 10,
                    alignItems: "flex-start",
                    border: "1px solid #eee",
                    borderRadius: 10,
                    padding: 10,
                    cursor: "pointer",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) => {
                      const isChecked = e.target.checked;
                      setSelectedPlanIds((prev) => {
                        const next = new Set(prev);
                        if (isChecked) next.add(pl.id);
                        else next.delete(pl.id);
                        return next;
                      });
                    }}
                    style={{ marginTop: 2 }}
                  />
                  <div>
                    <div style={{ fontWeight: 800 }}>{planLabel(pl)}</div>
                    <div style={{ opacity: 0.75, fontSize: 12 }}>
                      start: {pl.start_date} - dni: {pl.days_count}
                    </div>
                  </div>
                </label>
              );
            })
          )}
        </div>
      </aside>
    </div>
  </main>
  );
}












