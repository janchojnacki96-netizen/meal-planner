"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { buildPlanVersionMap, formatPlanLabel } from "@/lib/plans";
import MobileDrawer from "@/components/MobileDrawer";
import { useBottomNavAction } from "@/components/BottomNavActionContext";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { Minus, Plus, Search, Trash2 } from "lucide-react";

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

type UndoAction =
  | {
      type: "qty";
      ingredientId: number;
      prevQty: number;
      nextQty: number;
      prevDone: boolean;
      nextDone: boolean;
    }
  | {
      type: "extraAdd";
      extra: ExtraRow;
    }
  | {
      type: "pantryTransfer";
      changes: Array<{
        ingredientId: number;
        prevQty: number | null;
        nextQty: number | null;
        hadRowBefore: boolean;
      }>;
    };

type PantryTransferChange = {
  ingredientId: number;
  prevQty: number | null;
  nextQty: number | null;
  hadRowBefore: boolean;
};

function fmtQty(n: number): string {
  const s = (Math.round(n * 100) / 100).toFixed(2);
  return s.replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
}

function parseIntQty(raw: string): number | null {
  const t = raw.trim();
  if (!t) return null;
  if (!/^\d+$/.test(t)) return null;
  return Number.parseInt(t, 10);
}

function qtyStepByUnit(unit: string): number {
  const normalized = unit.trim().toLowerCase();
  return normalized === "g" || normalized === "ml" ? 50 : 1;
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
  const { setBottomNavAction } = useBottomNavAction();

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
  const [extraSuggestOpen, setExtraSuggestOpen] = useState(false);
  const [listSearch, setListSearch] = useState("");
  const [bulkTransferBusy, setBulkTransferBusy] = useState(false);
  const [bulkExtrasBusy, setBulkExtrasBusy] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<{ current: number; total: number } | null>(null);
  const [undoBusy, setUndoBusy] = useState(false);
  const [undoCount, setUndoCount] = useState(0);
  const [confirmTransferOpen, setConfirmTransferOpen] = useState(false);
  const [confirmDeleteExtrasOpen, setConfirmDeleteExtrasOpen] = useState(false);

  // UI
  const [hideZero, setHideZero] = useState(true);
  const [plansDrawerOpen, setPlansDrawerOpen] = useState(false);
  const undoStackRef = useRef<UndoAction[]>([]);

  const loading = initialLoading || planLoading;
  const selectedPlanIdsArray = useMemo(() => Array.from(selectedPlanIds), [selectedPlanIds]);
  const planVersionById = useMemo(() => buildPlanVersionMap(allPlans), [allPlans]);

  function planLabel(pl: MealPlan): string {
    return formatPlanLabel(pl, planVersionById);
  }

  function pushUndo(action: UndoAction) {
    const next = [...undoStackRef.current, action];
    undoStackRef.current = next.slice(-30);
    setUndoCount(undoStackRef.current.length);
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
      ? `Przenoszę… (${bulkProgress.current}/${bulkProgress.total})`
      : "Przenoszę…"
    : "Przenieś całą listę do pantry";
  const bulkExtrasLabel = bulkExtrasBusy ? "Usuwanie…" : "Usuń wszystkie dodatki";

  function getDone(ingredientId: number): boolean {
    return shoppingState.get(ingredientId)?.done ?? false;
  }

  function getQtyInput(ingredientId: number, fallback: number): string {
    const v = inputQty.get(ingredientId);
    if (v !== undefined) return v;
    return String(Math.max(0, Math.round(fallback)));
  }

  const getDefaultQty = useCallback((item: ComputedItem): number => {
    const state = shoppingState.get(item.ingredient_id);
    if (state?.done) return Math.max(0, Math.round(item.toBuy));
    const saved = state?.purchased_qty;
    if (typeof saved === "number" && Number.isFinite(saved)) return Math.max(0, Math.round(saved));
    return Math.max(0, Math.round(item.toBuy));
  }, [shoppingState]);

  const effectiveQtyById = useMemo(() => {
    const map = new Map<number, number>();
    for (const item of computedItems) {
      const raw = inputQty.get(item.ingredient_id);
      if (raw === undefined || raw.trim() === "") {
        map.set(item.ingredient_id, getDefaultQty(item));
        continue;
      }
      const parsed = parseIntQty(raw);
      if (parsed === null) {
        map.set(item.ingredient_id, getDefaultQty(item));
      } else {
        map.set(item.ingredient_id, Math.max(0, parsed));
      }
    }
    return map;
  }, [computedItems, getDefaultQty, inputQty]);

  const listFilterNormalized = listSearch.trim().toLowerCase();

  const filteredExtras = useMemo(() => {
    if (!listFilterNormalized) return extras;
    return extras.filter((x) => x.name.toLowerCase().includes(listFilterNormalized));
  }, [extras, listFilterNormalized]);

  const extraSuggestions = useMemo(() => {
    const q = extraName.trim().toLowerCase();
    if (q.length < 2) return [];
    return ingredients
      .filter((ing) => ing.name.toLowerCase().includes(q))
      .slice(0, 10);
  }, [extraName, ingredients]);

  const upsertShoppingState = useCallback(async (
    planId: string,
    ingredientId: number,
    done: boolean,
    purchasedQty: number | null
  ): Promise<boolean> => {
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
  }, [supabase, userId]);

  function setQtyInputValue(ingredientId: number, value: string | null) {
    setInputQty((prev) => {
      const next = new Map(prev);
      if (value === null) next.delete(ingredientId);
      else next.set(ingredientId, value);
      return next;
    });
  }

  const persistIngredientState = useCallback(async (ingredientId: number, qty: number, done: boolean): Promise<boolean> => {
    const planIds = selectedPlanIdsArray;
    if (planIds.length === 0) return false;

    const perPlanQty = qty / planIds.length;
    const results = await Promise.all(
      planIds.map((planId) => upsertShoppingState(planId, ingredientId, done, perPlanQty))
    );
    return results.every(Boolean);
  }, [selectedPlanIdsArray, upsertShoppingState]);

  async function applyIngredientQtyChange(
    ingredientId: number,
    nextQty: number,
    options?: { doneOverride?: boolean; pushUndo?: boolean }
  ): Promise<boolean> {
    const prevRow = shoppingState.get(ingredientId);
    const prevDone = prevRow?.done ?? false;
    const prevQty = effectiveQtyById.get(ingredientId) ?? Math.max(0, Math.round(toBuyById.get(ingredientId) ?? 0));

    const normalized = Math.max(0, Math.round(nextQty));
    const nextDone = options?.doneOverride ?? prevDone;

    if (normalized === prevQty && nextDone === prevDone) {
      setQtyInputValue(ingredientId, String(normalized));
      return true;
    }

    setBusyIds((prev) => new Set(prev).add(ingredientId));
    setQtyInputValue(ingredientId, String(normalized));
    setShoppingState((prev) => {
      const next = new Map(prev);
      next.set(ingredientId, { ingredient_id: ingredientId, done: nextDone, purchased_qty: normalized });
      return next;
    });

    try {
      const ok = await persistIngredientState(ingredientId, normalized, nextDone);
      if (!ok) {
        setShoppingState((prev) => {
          const next = new Map(prev);
          if (prevRow) next.set(ingredientId, prevRow);
          else next.delete(ingredientId);
          return next;
        });
        if (typeof prevRow?.purchased_qty === "number" && Number.isFinite(prevRow.purchased_qty)) {
          setQtyInputValue(ingredientId, String(Math.max(0, Math.round(prevRow.purchased_qty))));
        } else {
          setQtyInputValue(ingredientId, null);
        }
        toast.error("Nie udało się zapisać ilości.");
        return false;
      }

      if (options?.pushUndo !== false) {
        pushUndo({
          type: "qty",
          ingredientId,
          prevQty,
          nextQty: normalized,
          prevDone,
          nextDone,
        });
      }
      return true;
    } finally {
      setBusyIds((prev) => {
        const next = new Set(prev);
        next.delete(ingredientId);
        return next;
      });
    }
  }

  async function commitQtyInput(item: ComputedItem) {
    const ingredientId = item.ingredient_id;
    const raw = inputQty.get(ingredientId);
    const fallback = getDefaultQty(item);

    if (raw === undefined || raw.trim() === "") {
      setQtyInputValue(ingredientId, String(fallback));
      return;
    }

    const parsed = parseIntQty(raw);
    if (parsed === null) {
      setQtyInputValue(ingredientId, String(fallback));
      return;
    }

    await applyIngredientQtyChange(ingredientId, parsed);
  }

  async function adjustQtyByStep(item: ComputedItem, direction: "minus" | "plus") {
    const current = effectiveQtyById.get(item.ingredient_id) ?? getDefaultQty(item);
    const step = qtyStepByUnit(item.unit);
    const delta = direction === "plus" ? step : -step;
    await applyIngredientQtyChange(item.ingredient_id, current + delta);
  }

  async function markItemAsRemoved(item: ComputedItem) {
    await applyIngredientQtyChange(item.ingredient_id, 0);
  }

  async function addToPantry(ingredientId: number, transferQty: number): Promise<PantryTransferChange | null> {
    if (!userId) return null;
    if (!Number.isFinite(transferQty) || transferQty <= 0) return null;

    const { data: existingRows, error: fetchErr } = await supabase
      .from("user_pantry")
      .select("ingredient_id,quantity")
      .eq("user_id", userId)
      .eq("ingredient_id", ingredientId)
      .limit(1);

    if (fetchErr) {
      logSupabaseError("addToPantry error", fetchErr);
      return null;
    }

    const existing = (existingRows ?? [])[0] as PantryRow | undefined;
    const hadRowBefore = Boolean(existing);
    const prevQty = hadRowBefore ? (existing?.quantity ?? null) : null;
    const nextQty = (prevQty ?? 0) + transferQty;

    if (existing) {
      const { error: updateErr } = await supabase
        .from("user_pantry")
        .update({ quantity: nextQty })
        .eq("user_id", userId)
        .eq("ingredient_id", ingredientId);
      if (updateErr) {
        logSupabaseError("addToPantry error", updateErr);
        return null;
      }
    } else {
      const { error: insertErr } = await supabase
        .from("user_pantry")
        .insert({ user_id: userId, ingredient_id: ingredientId, quantity: nextQty });
      if (insertErr) {
        logSupabaseError("addToPantry error", insertErr);
        return null;
      }
    }

    setPantry((prev) => {
      const next = new Map(prev);
      next.set(ingredientId, { ingredient_id: ingredientId, quantity: nextQty });
      return next;
    });

    return { ingredientId, prevQty, nextQty, hadRowBefore };
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
      const fallbackQty = effectiveQtyById.get(ingredientId) ?? Math.max(0, Math.round(toBuyById.get(ingredientId) ?? 0));
      const normalizedQty = purchasedQty === null ? fallbackQty : Math.max(0, Math.round(purchasedQty));

      const perPlanQty = normalizedQty / planIds.length;
      const results = await Promise.all(
        planIds.map((planId) => upsertShoppingState(planId, ingredientId, done, perPlanQty))
      );
      if (results.some((ok) => !ok)) {
        toast.error("Nie udało się zaktualizować pozycji.");
        return;
      }

      setShoppingState((prev) => {
        const next = new Map(prev);
        next.set(ingredientId, { ingredient_id: ingredientId, done, purchased_qty: normalizedQty });
        return next;
      });

      if (done && normalizedQty > 0) {
        const change = await addToPantry(ingredientId, normalizedQty);
        if (!change) {
          toast.error("Nie udało się przenieść produktu do pantry.");
          return;
        }
        pushUndo({ type: "pantryTransfer", changes: [change] });
        setQtyInputValue(ingredientId, null);
      }
    } finally {
      setBusyIds((prev) => {
        const next = new Set(prev);
        next.delete(ingredientId);
        return next;
      });
    }
  }

  async function addExtraByName(nameRaw: string, pushUndoAction = true) {
    if (!plan || !userId) return false;
    const name = nameRaw.trim();
    if (!name) return false;

    const { data, error } = await supabase
      .from("user_shopping_extras")
      .insert({ user_id: userId, meal_plan_id: plan.id, name })
      .select("id,name,done,meal_plan_id")
      .single();

    if (error) {
      logSupabaseError("addExtra error", error);
      toast.error(error.message ?? "Nie udało się dodać produktu.");
      return false;
    }

    const extra = data as ExtraRow;
    setExtras((prev) => [extra, ...prev]);
    if (pushUndoAction) pushUndo({ type: "extraAdd", extra });
    return true;
  }

  async function addExtra() {
    const ok = await addExtraByName(extraName);
    if (!ok) return;
    setExtraName("");
    setExtraSuggestOpen(false);
  }

  async function toggleExtraDone(extraId: string, done: boolean) {
    setExtras((prev) => prev.map((x) => (x.id === extraId ? { ...x, done } : x)));
    const { error } = await supabase.from("user_shopping_extras").update({ done }).eq("id", extraId);
    if (error) logSupabaseError("toggleExtraDone error", error);
  }

  async function deleteExtra(extraId: string) {
    setExtras((prev) => prev.filter((x) => x.id !== extraId));
    const { error } = await supabase.from("user_shopping_extras").delete().eq("id", extraId);
    if (error) logSupabaseError("deleteExtra error", error);
  }

  async function transferAllToPantry() {
    if (!userId) return;
    if (bulkTransferBusy) return;

    const itemsToTransfer = computedItems
      .map((item) => ({
        ingredientId: item.ingredient_id,
        qty: effectiveQtyById.get(item.ingredient_id) ?? getDefaultQty(item),
      }))
      .filter((item) => item.qty > 0);

    if (itemsToTransfer.length === 0) {
      toast.info("Brak pozycji do przeniesienia.");
      return;
    }

    setBulkTransferBusy(true);
    setBulkProgress({ current: 0, total: itemsToTransfer.length });

    try {
      let current = 0;
      const changes: PantryTransferChange[] = [];

      for (const item of itemsToTransfer) {
        const change = await addToPantry(item.ingredientId, item.qty);
        if (!change) {
          toast.error("Nie udało się przenieść całej listy do pantry.");
          return;
        }
        changes.push(change);

        setShoppingState((prev) => {
          const next = new Map(prev);
          const prevRow = next.get(item.ingredientId);
          next.set(item.ingredientId, {
            ingredient_id: item.ingredientId,
            done: prevRow?.done ?? true,
            purchased_qty: item.qty,
          });
          return next;
        });
        setQtyInputValue(item.ingredientId, null);

        current += 1;
        setBulkProgress({ current, total: itemsToTransfer.length });
      }

      pushUndo({ type: "pantryTransfer", changes });
      toast.success("Przeniesiono całą listę do pantry.");

      if (extras.length > 0) {
        setConfirmDeleteExtrasOpen(true);
      }
    } finally {
      setBulkTransferBusy(false);
      setBulkProgress(null);
    }
  }

  async function deleteAllExtras(): Promise<boolean> {
    if (!userId) return false;

    setBulkExtrasBusy(true);
    try {
      const { error } = await supabase.from("user_shopping_extras").delete().eq("user_id", userId);
      if (error) {
        logSupabaseError("deleteAllExtras error", error);
        toast.error(error.message ?? "Nie udało się usunąć dodatków.");
        return false;
      }
      setExtras([]);
      toast.success("Usunięto wszystkie dodatki.");
      return true;
    } finally {
      setBulkExtrasBusy(false);
    }
  }

  const handleUndo = useCallback(async () => {
    if (undoBusy) return;
    if (!userId) return;

    const last = undoStackRef.current[undoStackRef.current.length - 1];
    if (!last) return;

    undoStackRef.current = undoStackRef.current.slice(0, -1);
    setUndoCount(undoStackRef.current.length);
    setUndoBusy(true);

    try {
      if (last.type === "qty") {
        const ok = await persistIngredientState(last.ingredientId, last.prevQty, last.prevDone);
        if (!ok) throw new Error("Nie udało się cofnąć zmiany ilości.");

        setShoppingState((prev) => {
          const next = new Map(prev);
          next.set(last.ingredientId, {
            ingredient_id: last.ingredientId,
            done: last.prevDone,
            purchased_qty: last.prevQty,
          });
          return next;
        });
        setQtyInputValue(last.ingredientId, String(last.prevQty));
        toast.success("Cofnięto zmianę ilości.");
      }

      if (last.type === "extraAdd") {
        const { error } = await supabase.from("user_shopping_extras").delete().eq("id", last.extra.id);
        if (error) throw new Error(error.message);
        setExtras((prev) => prev.filter((x) => x.id !== last.extra.id));
        toast.success("Cofnięto dodanie dodatkowego produktu.");
      }

      if (last.type === "pantryTransfer") {
        for (const change of last.changes) {
          if (change.hadRowBefore) {
            const { error } = await supabase
              .from("user_pantry")
              .update({ quantity: change.prevQty })
              .eq("user_id", userId)
              .eq("ingredient_id", change.ingredientId);
            if (error) throw new Error(error.message);
          } else {
            const { error } = await supabase
              .from("user_pantry")
              .delete()
              .eq("user_id", userId)
              .eq("ingredient_id", change.ingredientId);
            if (error) throw new Error(error.message);
          }
        }

        setPantry((prev) => {
          const next = new Map(prev);
          for (const change of last.changes) {
            if (change.hadRowBefore) {
              next.set(change.ingredientId, {
                ingredient_id: change.ingredientId,
                quantity: change.prevQty,
              });
            } else {
              next.delete(change.ingredientId);
            }
          }
          return next;
        });
        toast.success("Cofnięto przeniesienie do pantry.");
      }
    } catch (error) {
      undoStackRef.current = [...undoStackRef.current, last].slice(-30);
      setUndoCount(undoStackRef.current.length);
      const message = error instanceof Error ? error.message : "Nie udało się cofnąć operacji.";
      toast.error(message);
    } finally {
      setUndoBusy(false);
    }
  }, [persistIngredientState, supabase, undoBusy, userId]);

  useEffect(() => {
    setBottomNavAction({
      label: undoBusy ? "Cofam…" : "Cofnij",
      disabled: undoBusy || undoCount === 0,
      onClick: () => {
        void handleUndo();
      },
    });
    return () => setBottomNavAction(null);
  }, [handleUndo, setBottomNavAction, undoBusy, undoCount]);

  const bulkActionButtons = (
    <>
      <Button
        onClick={() => setSelectedPlanIds(new Set(allPlans.map((pl) => pl.id)))}
        disabled={allPlans.length === 0 || selectedPlanIds.size === allPlans.length}
        variant="secondary"
        size="sm"
      >
        Zaznacz wszystkie
      </Button>
      <Button
        onClick={() => setSelectedPlanIds(new Set())}
        disabled={selectedPlanIds.size === 0}
        variant="secondary"
        size="sm"
      >
        Wyczyść
      </Button>
      <Button
        onClick={() => setConfirmTransferOpen(true)}
        disabled={computedItems.length === 0 || bulkTransferBusy}
        size="sm"
      >
        {bulkTransferLabel}
      </Button>
      <Button
        onClick={() => setConfirmDeleteExtrasOpen(true)}
        disabled={extras.length === 0 || bulkExtrasBusy}
        variant="secondary"
        size="sm"
      >
        {bulkExtrasLabel}
      </Button>
    </>
  );

  const plansPanel = (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="section-title">Wybierz plany</h2>
        <span className="badge">{selectedPlanIds.size}</span>
      </div>
      <div className="flex flex-wrap gap-2">{bulkActionButtons}</div>

      <div className="max-h-[60vh] space-y-2 overflow-y-auto pr-1">
        {allPlans.length === 0 ? (
          <div className="text-sm text-slate-500">Brak planów.</div>
        ) : (
          allPlans.map((pl) => {
            const checked = selectedPlanIds.has(pl.id);

            return (
              <label
                key={pl.id}
                className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-white p-3 text-sm"
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
                  className="mt-1 h-4 w-4"
                />
                <div>
                  <div className="font-semibold text-slate-900">{planLabel(pl)}</div>
                  <div className="text-xs text-slate-500">
                    start: {pl.start_date} • dni: {pl.days_count}
                  </div>
                </div>
              </label>
            );
          })
        )}
      </div>
    </div>
  );

  if (loading) {
    return (
      <main className="card">
        <p className="text-sm text-slate-600">Ładowanie...</p>
      </main>
    );
  }

  return (
    <main className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-6">
          <header className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-2xl font-semibold text-slate-900">Lista zakupów</h1>
              <p className="text-sm text-slate-600">
                Wybrane plany: <b className="text-slate-900">{selectedPlanIds.size}</b>
              </p>
              {allPlans.length === 0 && (
                <p className="text-sm text-slate-500">
                  Brak planu - przejdź do jadłospisu i wygeneruj plan.
                </p>
              )}
            </div>
            <Button onClick={() => setPlansDrawerOpen(true)} variant="secondary" className="lg:hidden">
              Wybierz plany
            </Button>
          </header>

          {loadError && (
            <section className="card border-amber-200 bg-amber-50 text-amber-900">
              <b>Uwaga:</b> {loadError}
            </section>
          )}

          <section className="card space-y-2">
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={hideZero}
                onChange={(e) => setHideZero(e.target.checked)}
                className="h-4 w-4"
              />
              Ukryj produkty (do kupienia = 0)
            </label>
            <p className="text-xs text-slate-500">
              Zaznaczenie jako kupione przenosi ilość do Pantry. Jeśli nie wpiszesz ilości, użyjemy wartości do kupienia.
            </p>
          </section>

          <section className="card space-y-2">
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Szukaj na liście</label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                value={listSearch}
                onChange={(e) => setListSearch(e.target.value)}
                placeholder="Szukaj na liście…"
                className="input pl-9"
              />
            </div>
          </section>

          <section className="space-y-4">
            {selectedPlanIds.size === 0 ? (
              <p className="text-sm text-slate-600">Zaznacz co najmniej 1 plan.</p>
            ) : computed.categories.length === 0 ? (
              <p className="text-sm text-slate-600">
                Nic do pokazania. Spróbuj odznaczyć filtr Ukryj do kupienia = 0.
              </p>
            ) : (
              computed.categories.map((cat) => {
                const items = computed.grouped.get(cat) ?? [];
                const visible = items.filter((it) => {
                  const qty = effectiveQtyById.get(it.ingredient_id) ?? getDefaultQty(it);
                  if (hideZero && qty <= 0) return false;
                  if (listFilterNormalized && !it.name.toLowerCase().includes(listFilterNormalized)) return false;
                  return true;
                });
                if (visible.length === 0) return null;

                return (
                  <details key={cat} className="card" open>
                    <summary className="flex cursor-pointer items-center justify-between text-sm font-semibold text-slate-900">
                      <span>{cat}</span>
                      <span className="badge">{visible.length}</span>
                    </summary>

                    <div className="mt-3 space-y-3">
                      {visible.map((it) => {
                        const done = getDone(it.ingredient_id);
                        const disabled = busyIds.has(it.ingredient_id);
                        const effectiveQty = effectiveQtyById.get(it.ingredient_id) ?? getDefaultQty(it);
                        const isRemoved = effectiveQty <= 0;

                        const qtyStr = getQtyInput(it.ingredient_id, effectiveQty);
                        const currentInput = inputQty.get(it.ingredient_id) ?? qtyStr;

                        const pantryFlag =
                          it.pantryQty === null
                            ? pantry.has(it.ingredient_id)
                              ? "oznaczone jako mam"
                              : "nie mam"
                            : `w pantry: ${fmtQty(it.pantryQty)} ${it.unit}`;

                        return (
                          <div
                            key={it.ingredient_id}
                            className={`flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-3 ${
                              isRemoved ? "opacity-50" : ""
                            }`}
                          >
                            <label className="flex flex-1 items-start gap-3 text-sm">
                              <input
                                type="checkbox"
                                checked={done}
                                disabled={disabled}
                                onChange={(e) => {
                                  const checked = e.target.checked;
                                  const qty = parseIntQty((inputQty.get(it.ingredient_id) ?? qtyStr) || "");
                                  toggleBoughtAndTransfer(it.ingredient_id, checked, qty);
                                }}
                                className="mt-1 h-4 w-4"
                              />
                              <div className="space-y-1">
                                <div className={`font-semibold text-slate-900 ${isRemoved ? "line-through" : ""}`}>
                                  {it.name} <span className="text-xs text-slate-400">#{it.ingredient_id}</span>
                                </div>
                                <div className="text-xs text-slate-500">
                                  potrzebne: <b className="text-slate-900">{fmtQty(it.needed)}</b> {it.unit} • {pantryFlag}
                                </div>
                                <div className="text-xs text-slate-500">
                                  do kupienia: <b className="text-slate-900">{fmtQty(effectiveQty)}</b> {it.unit}
                                </div>
                              </div>
                            </label>

                            <div className="grid gap-2 sm:grid-cols-[auto_auto_auto] sm:items-end">
                              <div className="flex flex-col gap-1 sm:min-w-[210px]">
                                <span className="text-[11px] uppercase tracking-wide text-slate-400">Ilość do pantry/listy</span>
                                <div className="flex items-center gap-1">
                                  <Button
                                    type="button"
                                    variant="secondary"
                                    size="icon"
                                    disabled={disabled}
                                    onClick={() => {
                                      void adjustQtyByStep(it, "minus");
                                    }}
                                    aria-label={`Zmniejsz ilość ${it.name}`}
                                    className="h-11 w-11"
                                  >
                                    <Minus className="h-4 w-4" />
                                  </Button>
                                  <input
                                    type="number"
                                    min={0}
                                    step={1}
                                    inputMode="numeric"
                                    value={currentInput}
                                    disabled={disabled}
                                    onChange={(e) => {
                                      const clean = e.target.value.replace(/[^\d]/g, "");
                                      setQtyInputValue(it.ingredient_id, clean);
                                    }}
                                    onBlur={() => {
                                      void commitQtyInput(it);
                                    }}
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter") {
                                        e.preventDefault();
                                        void commitQtyInput(it);
                                      }
                                    }}
                                    className="input h-11 text-center"
                                  />
                                  <Button
                                    type="button"
                                    variant="secondary"
                                    size="icon"
                                    disabled={disabled}
                                    onClick={() => {
                                      void adjustQtyByStep(it, "plus");
                                    }}
                                    aria-label={`Zwiększ ilość ${it.name}`}
                                    className="h-11 w-11"
                                  >
                                    <Plus className="h-4 w-4" />
                                  </Button>
                                </div>
                                <span className="text-[11px] text-slate-400">
                                  Skok +/-: {qtyStepByUnit(it.unit)} {it.unit || "szt"}
                                </span>
                              </div>

                              <Button
                                disabled={disabled || effectiveQty <= 0}
                                onClick={async () => {
                                  const change = await addToPantry(it.ingredient_id, effectiveQty);
                                  if (!change) {
                                    toast.error("Nie udało się przenieść produktu do pantry.");
                                    return;
                                  }
                                  setShoppingState((prev) => {
                                    const next = new Map(prev);
                                    next.set(it.ingredient_id, {
                                      ingredient_id: it.ingredient_id,
                                      done: true,
                                      purchased_qty: effectiveQty,
                                    });
                                    return next;
                                  });
                                  setQtyInputValue(it.ingredient_id, null);
                                  pushUndo({ type: "pantryTransfer", changes: [change] });
                                  toast.success("Przeniesiono produkt do pantry.");
                                }}
                                title="Przenieś do pantry (bez odhaczania)"
                                variant="secondary"
                                className="h-11"
                              >
                                Do pantry
                              </Button>

                              <Button
                                type="button"
                                variant="secondary"
                                size="icon"
                                disabled={disabled || isRemoved}
                                onClick={() => {
                                  void markItemAsRemoved(it);
                                }}
                                aria-label={`Usuń ${it.name} z listy`}
                                className="h-11 w-11"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </details>
                );
              })
            )}
            {selectedPlanIds.size > 0 && computed.categories.length > 0 && listFilterNormalized && (
              computed.categories.every((cat) => {
                const items = computed.grouped.get(cat) ?? [];
                return items.every((it) => {
                  const qty = effectiveQtyById.get(it.ingredient_id) ?? getDefaultQty(it);
                  if (hideZero && qty <= 0) return true;
                  return !it.name.toLowerCase().includes(listFilterNormalized);
                });
              }) ? (
                <p className="text-sm text-slate-500">Brak produktów pasujących do filtra.</p>
              ) : null
            )}
          </section>

          <section className="card space-y-3">
            <h2 className="section-title">Dodatkowe zakupy (poza bazą)</h2>

            <div className="relative">
              <div className="flex flex-wrap items-center gap-2">
                <input
                  value={extraName}
                  onChange={(e) => {
                    setExtraName(e.target.value);
                    setExtraSuggestOpen(true);
                  }}
                  onFocus={() => setExtraSuggestOpen(true)}
                  onBlur={() => setTimeout(() => setExtraSuggestOpen(false), 150)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void addExtra();
                    }
                  }}
                  placeholder="np. papier toaletowy"
                  className="input flex-1"
                />
                <Button onClick={() => void addExtra()} disabled={!plan || !extraName.trim()}>
                  Dodaj
                </Button>
              </div>

              {extraSuggestOpen && extraSuggestions.length > 0 && extraName.trim().length >= 2 && (
                <div className="absolute left-0 right-0 top-full z-20 mt-2 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg">
                  {extraSuggestions.map((ing) => (
                    <button
                      key={ing.id}
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        setExtraName(ing.name);
                        setExtraSuggestOpen(false);
                      }}
                      className="w-full border-b border-slate-100 px-3 py-2 text-left hover:bg-slate-50"
                    >
                      <div className="font-semibold text-slate-900">{ing.name}</div>
                      <div className="text-xs text-slate-500">
                        #{ing.id} • {ing.category ?? "bez kategorii"}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-2">
              {filteredExtras.length === 0 ? (
                <p className="text-sm text-slate-500">
                  {listFilterNormalized ? "Brak dodatkowych pozycji pasujących do filtra." : "Brak dodatkowych pozycji."}
                </p>
              ) : (
                filteredExtras.map((x) => (
                  <div
                    key={x.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3"
                  >
                    <label className="flex items-center gap-3 text-sm">
                      <input
                        type="checkbox"
                        checked={x.done}
                        onChange={(e) => toggleExtraDone(x.id, e.target.checked)}
                        className="h-4 w-4"
                      />
                      <span className={`font-semibold text-slate-900 ${x.done ? "line-through opacity-60" : ""}`}>
                        {x.name}
                      </span>
                    </label>

                    <Button
                      onClick={() => deleteExtra(x.id)}
                      title="Usuń"
                      variant="secondary"
                      className="h-11 min-w-11 px-3"
                    >
                      Usuń
                    </Button>
                  </div>
                ))
              )}
            </div>
          </section>
        </div>

        <aside className="hidden lg:block">
          <div className="card sticky top-6">{plansPanel}</div>
        </aside>
      </div>

      <MobileDrawer open={plansDrawerOpen} onClose={() => setPlansDrawerOpen(false)} title="Wybierz plany" side="bottom">
        {plansPanel}
      </MobileDrawer>

      <div className="fixed bottom-16 left-0 right-0 z-30 lg:hidden">
        <div className="mx-auto max-w-6xl px-3">
          <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-lg">
            <div className="grid grid-cols-2 gap-2">{bulkActionButtons}</div>
          </div>
        </div>
      </div>

      <AlertDialog open={confirmTransferOpen} onOpenChange={setConfirmTransferOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Przenieść całą listę do pantry?</AlertDialogTitle>
            <AlertDialogDescription>
              Operacja przeniesie wszystkie aktualne ilości z listy do pantry.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Anuluj</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                void transferAllToPantry();
              }}
            >
              Przenieś
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmDeleteExtrasOpen} onOpenChange={setConfirmDeleteExtrasOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Usunąć wszystkie dodatki?</AlertDialogTitle>
            <AlertDialogDescription>
              Ta operacja usunie wszystkie dodatkowe produkty wpisane ręcznie.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Anuluj</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                void deleteAllExtras();
              }}
            >
              Usuń
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}
