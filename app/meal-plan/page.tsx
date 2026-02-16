"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { buildPlanVersionMap, formatPlanLabel } from "@/lib/plans";
import { useSwipeable } from "react-swipeable";

type MealType = "breakfast" | "lunch" | "dinner";
type Pref = "favorite" | "dislike";

type RecipePreferenceRow = {
  recipe_id: number;
  preference: Pref;
};

type SlotHistoryRow = {
  date: string;
  meal_type: MealType;
  recipe_id: number;
  servings: number;
};

type Recipe = {
  id: number;
  name: string;
  meal_type: MealType;
  base_servings: number;
  steps?: string[] | null;
};

type RecipeIngRow = {
  recipe_id: number;
  ingredient_id: number;
  amount: number | null; // <-- u Ciebie amount
  unit: string | null;
};

type RecipeIngredientDisplay = {
  ingredient_id: number;
  name: string;
  amount: number | null;
  unit: string | null;
};

type Slot = {
  id: string;
  date: string; // YYYY-MM-DD
  meal_type: MealType;
  recipe_id: number | null;
  servings: number; // 0 = resztki
};

type MealPlan = {
  id: string;
  start_date: string;
  days_count: number;
  created_at: string;
};

type Ingredient = {
  id: number;
  name: string;
  unit: string;
  category: string | null;
};

function toISODate(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function addDaysISO(startISO: string, offset: number): string {
  const d = new Date(startISO + "T00:00:00");
  d.setDate(d.getDate() + offset);
  return toISODate(d);
}

function diffDaysISO(dateA: string, dateB: string): number {
  const a = new Date(dateA + "T00:00:00").getTime();
  const b = new Date(dateB + "T00:00:00").getTime();
  return Math.round((a - b) / (1000 * 60 * 60 * 24));
}

function fmtNumPL(n: number): string {
  // 2 miejsca po przecinku, z przecinkiem dziesiętnym, bez trailing zeros
  const s = (Math.round(n * 100) / 100).toFixed(2);
  const trimmed = s.replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
  return trimmed.replace(".", ",");
}

function fmtAmount(n: number): string {
  const s = (Math.round(n * 100) / 100).toFixed(2);
  return s.replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
}

function leftoverOrdinalPL(k: number): string {
  // k: 1 => drugi dzień, 2 => trzeci dzień...
  const map: Record<number, string> = {
    1: "drugi dzień",
    2: "trzeci dzień",
    3: "czwarty dzień",
    4: "piąty dzień",
    5: "szósty dzień",
    6: "siódmy dzień",
  };
  return map[k] ?? `${k + 1}. dzień`;
}

function MealSlotRow(props: {
  slot: Slot | undefined;
  label: string;
  title: string;
  isLeftovers: boolean;
  isSwapping: boolean;

  recipeId: number | null;
  steps: string[];
  ingredientRows: RecipeIngredientDisplay[];
  recipeBaseServings: number | null;

  onReplace: (slot: Slot) => void;
  onDislikeAndReplace: (slot: Slot) => void;
  onToggleFavorite: (slot: Slot) => void;
  pref: Pref | null;

  onUpdateServings: (slotId: string, servings: number) => void;
  onOpenSearch: (slot: Slot) => void;
  onCloseSearch: () => void;
  onSearchQueryChange: (value: string) => void;
  onSelectSearchRecipe: (slot: Slot, recipeId: number) => void;
  searchOpen: boolean;
  searchQuery: string;
  searchResults: Recipe[];
  searchBusy: boolean;
  searchDisabled: boolean;
}) {
  const {
    slot,
    label,
    title,
    isLeftovers,
    isSwapping,
    recipeId,
    steps,
    ingredientRows,
    recipeBaseServings,
    onReplace,
    onDislikeAndReplace,
    onToggleFavorite,
    pref,
    onUpdateServings,
    onOpenSearch,
    onCloseSearch,
    onSearchQueryChange,
    onSelectSearchRecipe,
    searchOpen,
    searchQuery,
    searchResults,
    searchBusy,
    searchDisabled,
  } = props;

  const [open, setOpen] = useState(false);

  const swipeHandlers = useSwipeable({
    onSwipedLeft: () => {
      if (slot && !isLeftovers) onReplace(slot);
    },
    onSwipedRight: () => {
      if (slot && !isLeftovers) onDislikeAndReplace(slot);
    },
    trackMouse: true,
  });

  return (
    <div
      {...swipeHandlers}
      style={{
        padding: "10px 0",
        borderTop: "1px solid #eee",
        display: "flex",
        flexDirection: "column",
        alignItems: "stretch",
        gap: 10,
        userSelect: "none",
      }}
      title="Swipe: lewo = zamień, prawo = 🚫 nie lubię + zamień"
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 10,
          alignItems: "center",
        }}
      >
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700 }}>
            {label}:{" "}
            <span style={{ fontWeight: 600 }}>
              {isLeftovers ? `Resztki: ${title}` : title}
            </span>
          </div>
          {slot?.recipe_id && (
            <div style={{ opacity: 0.7, fontSize: 13 }}>recipe_id: {slot.recipe_id}</div>
          )}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ opacity: 0.8 }}>porcje</span>
            <input
              type="number"
              min={0}
              value={slot?.servings ?? 0}
              disabled={!slot}
              onChange={(e) => slot && onUpdateServings(slot.id, Number(e.target.value))}
              style={{ width: 80, padding: 6 }}
            />
          </div>

          <button
            disabled={!slot || isLeftovers || isSwapping || searchDisabled}
            onClick={() => slot && onOpenSearch(slot)}
            title="Wybierz przepis"
          >
            🔎
          </button>

          <button
            disabled={!slot || !slot.recipe_id || isLeftovers || isSwapping}
            onClick={() => slot && onReplace(slot)}
            title="Zamień przepis"
          >
            {isSwapping ? "Zmieniam…" : "Zamień"}
          </button>

          <button
            disabled={!slot || !slot.recipe_id || isLeftovers || isSwapping}
            onClick={() => slot && onDislikeAndReplace(slot)}
            title="Nie lubię (blacklista) + zamień"
          >
            🚫
          </button>

          <button
            disabled={!slot || !slot.recipe_id || isLeftovers || isSwapping}
            onClick={() => slot && onToggleFavorite(slot)}
            title="Ulubione (bonus przy wyborze)"
          >
            {pref === "favorite" ? "⭐" : "☆"}
          </button>

          <button
            disabled={!recipeId || (steps.length === 0 && ingredientRows.length === 0)}
            onClick={() => setOpen((v) => !v)}
            title="Pokaż / ukryj szczegóły"
          >
            {open ? "Zwiń ▲" : "Kroki ▼"}
          </button>
        </div>
      </div>

      {searchOpen && slot && !isLeftovers && (
        <div
          style={{
            marginTop: 8,
            border: "1px solid #ddd",
            borderRadius: 10,
            padding: 10,
            background: "white",
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Wybierz przepis</div>
          <input
            value={searchQuery}
            onChange={(e) => onSearchQueryChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") onCloseSearch();
            }}
            placeholder="Wpisz min. 2 litery"
            style={{ padding: 8, width: "100%" }}
          />
          <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
            <button onClick={onCloseSearch} disabled={searchBusy}>
              Anuluj
            </button>
          </div>
          <div style={{ marginTop: 8 }}>
            {searchQuery.trim().length < 2 ? (
              <div style={{ opacity: 0.7, fontSize: 13 }}>Wpisz min. 2 litery.</div>
            ) : searchResults.length === 0 ? (
              <div style={{ opacity: 0.7, fontSize: 13 }}>
                Brak pasujących przepisów (sprawdź blokady, cooldown lub duplikaty).
              </div>
            ) : (
              <div
                style={{
                  border: "1px solid #eee",
                  borderRadius: 8,
                  maxHeight: 220,
                  overflowY: "auto",
                }}
              >
                {searchResults.map((rec) => (
                  <button
                    key={rec.id}
                    onClick={() => onSelectSearchRecipe(slot, rec.id)}
                    disabled={searchBusy}
                    style={{
                      width: "100%",
                      textAlign: "left",
                      padding: 8,
                      border: "none",
                      background: "white",
                      cursor: "pointer",
                      borderBottom: "1px solid #f0f0f0",
                    }}
                    title={`Wybierz #${rec.id}`}
                  >
                    <div style={{ fontWeight: 600 }}>{rec.name}</div>
                    <div style={{ opacity: 0.6, fontSize: 12 }}>ID: {rec.id}</div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {open && (steps.length > 0 || ingredientRows.length > 0) && (
        <div
          style={{
            padding: 10,
            background: "#fafafa",
            border: "1px solid #eee",
            borderRadius: 10,
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 8 }}>
            Składniki{isLeftovers ? " (resztki)" : ""}
          </div>
          {ingredientRows.length === 0 ? (
            <div style={{ opacity: 0.75, fontSize: 13 }}>Brak składników w bazie.</div>
          ) : (
            <ul style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 6 }}>
              {ingredientRows.map((row) => {
                const baseAmount = row.amount;
                let displayAmount: string | null = null;
                if (typeof baseAmount === "number" && Number.isFinite(baseAmount)) {
                  // TODO: Jeśli brak bazowej liczby porcji, pokazuj ilość bez skalowania.
                  const canScale =
                    slot && slot.servings > 0 && recipeBaseServings !== null && recipeBaseServings > 0;
                  const scale = canScale ? slot.servings / recipeBaseServings : 1;
                  const scaled = baseAmount * scale;
                  if (Number.isFinite(scaled)) displayAmount = fmtAmount(scaled);
                }

                const amountText = displayAmount ?? "—";
                const unitText = row.unit ? ` ${row.unit}` : "";

                return (
                  <li key={row.ingredient_id} style={{ lineHeight: 1.35 }}>
                    {row.name} — {amountText}
                    {unitText}
                  </li>
                );
              })}
            </ul>
          )}

          {steps.length > 0 && (
            <>
              <div style={{ fontWeight: 700, margin: "12px 0 8px" }}>Kroki</div>
              <ol style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 6 }}>
                {steps.map((step, idx) => (
                  <li key={idx} style={{ lineHeight: 1.35 }}>
                    {step}
                  </li>
                ))}
              </ol>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default function MealPlanPage() {
  const supabase = createClient();
  const router = useRouter();
  const searchParams = useSearchParams();

  // formularz
  const [startDate, setStartDate] = useState<string>(toISODate(new Date()));
  const [daysCount, setDaysCount] = useState<number>(7);
  const [people, setPeople] = useState<number>(3);
  const [lunchSpanDays, setLunchSpanDays] = useState<number>(1);

  // cooldown
  const [cooldownDays, setCooldownDays] = useState<number>(14);

  // składniki do wykorzystania (autocomplete)
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [ingredientQuery, setIngredientQuery] = useState("");
  const [ingredientSuggestOpen, setIngredientSuggestOpen] = useState(false);
  const [selectedIngredientIds, setSelectedIngredientIds] = useState<Set<number>>(new Set());
  const [useIngredientIdsHard, setUseIngredientIdsHard] = useState(false);

  // preferuj pantry
  const [preferPantry, setPreferPantry] = useState(true);

  // dane
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [recipeIngs, setRecipeIngs] = useState<RecipeIngRow[]>([]);
  const [pantryIds, setPantryIds] = useState<Set<number>>(new Set());

  // preferencje
  const [userId, setUserId] = useState<string | null>(null);
  const [prefs, setPrefs] = useState<Map<number, Pref>>(new Map());
  const [blockedIngredientIds, setBlockedIngredientIds] = useState<Set<number>>(new Set());

  // plany
  const [allPlans, setAllPlans] = useState<MealPlan[]>([]);
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);

  // aktywny plan
  const [activePlan, setActivePlan] = useState<MealPlan | null>(null);
  const [slots, setSlots] = useState<Slot[]>([]);

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [swappingSlotIds, setSwappingSlotIds] = useState<Set<string>>(new Set());
  const [openSearchForSlotId, setOpenSearchForSlotId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  // --- mapy ---
  const ingredientsById = useMemo(() => {
    const m = new Map<number, Ingredient>();
    for (const i of ingredients) m.set(i.id, i);
    return m;
  }, [ingredients]);

  const recipesById = useMemo(() => {
    const m = new Map<number, Recipe>();
    for (const r of recipes) m.set(r.id, r);
    return m;
  }, [recipes]);

  const recipeIngSetByRecipe = useMemo(() => {
    const m = new Map<number, Set<number>>();
    for (const row of recipeIngs) {
      const set = m.get(row.recipe_id) ?? new Set<number>();
      set.add(row.ingredient_id);
      m.set(row.recipe_id, set);
    }
    return m;
  }, [recipeIngs]);

  const recipeIngRowsByRecipe = useMemo(() => {
    const m = new Map<number, RecipeIngRow[]>();
    for (const row of recipeIngs) {
      const arr = m.get(row.recipe_id) ?? [];
      arr.push(row);
      m.set(row.recipe_id, arr);
    }
    return m;
  }, [recipeIngs]);

  const recipeIngredientsByRecipe = useMemo(() => {
    const m = new Map<number, RecipeIngredientDisplay[]>();
    for (const row of recipeIngs) {
      const ingredient = ingredientsById.get(row.ingredient_id);
      const list = m.get(row.recipe_id) ?? [];
      list.push({
        ingredient_id: row.ingredient_id,
        name: ingredient?.name ?? `#${row.ingredient_id}`,
        amount: row.amount ?? null,
        unit: row.unit ?? ingredient?.unit ?? null,
      });
      m.set(row.recipe_id, list);
    }
    return m;
  }, [recipeIngs, ingredientsById]);

  const selectedIngredients = useMemo(() => {
    return [...selectedIngredientIds]
      .map((id) => ingredientsById.get(id))
      .filter(Boolean) as Ingredient[];
  }, [selectedIngredientIds, ingredientsById]);

  const suggestions = useMemo(() => {
    const q = ingredientQuery.trim().toLowerCase();
    if (q.length < 2) return [];
    return ingredients
      .filter((i) => !selectedIngredientIds.has(i.id))
      .filter((i) => i.name.toLowerCase().includes(q))
      .slice(0, 10);
  }, [ingredientQuery, ingredients, selectedIngredientIds]);

  function addSelectedIngredient(id: number) {
    setSelectedIngredientIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
    setIngredientQuery("");
    setIngredientSuggestOpen(false);
  }

  function removeSelectedIngredient(id: number) {
    setSelectedIngredientIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }

  function clearSelectedIngredients() {
    setSelectedIngredientIds(new Set());
    setIngredientQuery("");
  }

  // --- start: load base data + plans list ---
  useEffect(() => {
    (async () => {
      setLoading(true);

      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) {
        router.push("/login");
        return;
      }
      setUserId(userData.user.id);

      const [
        { data: r },
        { data: ri },
        { data: pan },
        { data: p },
        { data: ing },
        { data: blocked },
        { data: plans },
      ] = await Promise.all([
        supabase.from("recipes").select("id,name,meal_type,base_servings,steps"),
        // <-- amount + unit (bo eksport HTML tego potrzebuje)
        supabase.from("recipe_ingredients").select("recipe_id,ingredient_id,amount,unit"),
        supabase.from("user_pantry").select("ingredient_id"),
        supabase.from("user_recipe_preferences").select("recipe_id,preference"),
        supabase.from("ingredients").select("id,name,unit,category").order("name"),
        supabase.from("user_blocked_ingredients").select("ingredient_id").eq("user_id", userData.user.id),
        supabase.from("meal_plans").select("id,start_date,days_count,created_at").order("created_at", { ascending: false }),
      ]);

      setRecipes((r ?? []) as Recipe[]);
      setRecipeIngs((ri ?? []) as RecipeIngRow[]);
      setPantryIds(new Set((pan ?? []).map((x) => x.ingredient_id)));
      setIngredients((ing ?? []) as Ingredient[]);
      setBlockedIngredientIds(new Set((blocked ?? []).map((x) => Number(x.ingredient_id))));

      const prefMap = new Map<number, Pref>();
      for (const row of (p ?? []) as RecipePreferenceRow[]) {
        prefMap.set(Number(row.recipe_id), row.preference as Pref);
      }
      setPrefs(prefMap);

      const plansList = (plans ?? []) as MealPlan[];
      setAllPlans(plansList);

      const urlPlan = searchParams.get("plan");
      const initial = (urlPlan && plansList.find((x) => x.id === urlPlan)?.id) || plansList[0]?.id || null;
      setSelectedPlanId(initial);

      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // load selected plan slots
  useEffect(() => {
    (async () => {
      if (!selectedPlanId) {
        setActivePlan(null);
        setSlots([]);
        return;
      }

      const { data: plan } = await supabase
        .from("meal_plans")
        .select("id,start_date,days_count,created_at")
        .eq("id", selectedPlanId)
        .single();

      const { data: s } = await supabase
        .from("meal_plan_slots")
        .select("id,date,meal_type,recipe_id,servings")
        .eq("meal_plan_id", selectedPlanId);

      setActivePlan(plan as MealPlan);
      setSlots((s ?? []) as Slot[]);
    })();
  }, [selectedPlanId, supabase]);

  // plan labels dd.mm.yyyy_vN
  const planVersionById = useMemo(() => buildPlanVersionMap(allPlans), [allPlans]);

  function planLabel(pl: MealPlan): string {
    return formatPlanLabel(pl, planVersionById);
  }

  const dislikedIds = useMemo(() => {
    const s = new Set<number>();
    for (const [rid, pref] of prefs.entries()) if (pref === "dislike") s.add(rid);
    return s;
  }, [prefs]);

  const desiredIdsSet = useMemo(() => new Set<number>([...selectedIngredientIds]), [selectedIngredientIds]);

  function recipeContainsBlocked(recipeId: number): boolean {
    if (blockedIngredientIds.size === 0) return false;
    const ingSet = recipeIngSetByRecipe.get(recipeId);
    if (!ingSet) return false;
    for (const ingId of ingSet) if (blockedIngredientIds.has(ingId)) return true;
    return false;
  }

  function getRecipeCandidates(slot: Slot | undefined, query: string): Recipe[] {
    if (!slot) return [];
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];

    const used = new Set<number>();
    for (const s of slots) {
      if (s.recipe_id && s.servings > 0) used.add(s.recipe_id);
    }
    if (slot.recipe_id) used.delete(slot.recipe_id);

    const cooldownExclude = getCooldownExcludeForSlot(slot);
    const hard = useIngredientIdsHard && desiredIdsSet.size > 0;

    let candidates = recipes
      .filter((r) => r.meal_type === slot.meal_type)
      .filter((r) => r.name.toLowerCase().includes(q))
      .filter((r) => !used.has(r.id))
      .filter((r) => !dislikedIds.has(r.id))
      .filter((r) => !cooldownExclude.has(r.id))
      .filter((r) => !recipeContainsBlocked(r.id));

    if (hard) {
      candidates = candidates.filter((r) => recipeHasAllDesired(r.id, desiredIdsSet));
    }

    candidates.sort((a, b) => a.name.localeCompare(b.name));
    return candidates.slice(0, 10);
  }

  function closeSearchPanel() {
    setOpenSearchForSlotId(null);
    setSearchQuery("");
  }

  function openSearchPanel(slot: Slot) {
    setOpenSearchForSlotId((prev) => (prev === slot.id ? null : slot.id));
    setSearchQuery("");
  }

  function mealLabel(mt: MealType) {
    if (mt === "breakfast") return "Śniadanie";
    if (mt === "lunch") return "Obiad";
    return "Kolacja";
  }

  function matchRatio(recipeId: number): number {
    const set = recipeIngSetByRecipe.get(recipeId);
    if (!set || set.size === 0) return 0;
    let have = 0;
    for (const id of set) if (pantryIds.has(id)) have++;
    return have / set.size;
  }

  function bonusFromPrefs(recipeId: number): number {
    const pref = prefs.get(recipeId);
    if (pref === "favorite") return 0.15;
    if (pref === "dislike") return -999;
    return 0;
  }

  function recipeHasAllDesired(recipeId: number, desired: Set<number>): boolean {
    if (desired.size === 0) return true;
    const ing = recipeIngSetByRecipe.get(recipeId) ?? new Set<number>();
    for (const d of desired) if (!ing.has(d)) return false;
    return true;
  }

  function desiredMatchRatio(recipeId: number, desired: Set<number>): number {
    if (desired.size === 0) return 0;
    const ing = recipeIngSetByRecipe.get(recipeId) ?? new Set<number>();
    let hit = 0;
    for (const d of desired) if (ing.has(d)) hit++;
    return hit / desired.size;
  }

  async function setPreference(recipeId: number, preference: Pref | null) {
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

    const { error } = await supabase.from("user_recipe_preferences").upsert(
      { user_id: userId, recipe_id: recipeId, preference },
      { onConflict: "user_id,recipe_id" }
    );
    if (error) console.error(error);
  }

  // -------- COOLDOWN HELPERS --------
  type UseEntry = { dayIndex: number; recipeId: number };

  function pruneQueue(queue: UseEntry[], currentDayIndex: number, cd: number): UseEntry[] {
    if (cd <= 0) return queue;
    return queue.filter((e) => e.dayIndex > currentDayIndex - cd);
  }

  function queueToSet(queue: UseEntry[]): Set<number> {
    const s = new Set<number>();
    for (const e of queue) s.add(e.recipeId);
    return s;
  }

  function getCooldownExcludeForSlot(slot: Slot): Set<number> {
    const out = new Set<number>();
    if (cooldownDays <= 0) return out;

    for (const s of slots) {
      if (!s.recipe_id) continue;
      if (s.servings <= 0) continue;
      if (s.meal_type !== slot.meal_type) continue;
      if (s.id === slot.id) continue;
      const dist = Math.abs(diffDaysISO(s.date, slot.date));
      if (dist < cooldownDays) out.add(s.recipe_id);
    }
    return out;
  }

  // -------- PICKING --------
  function pickRecipe(mealType: MealType, used: Set<number>, extraExclude: Set<number>): number | null {
    const desired = desiredIdsSet;
    const hard = useIngredientIdsHard && desired.size > 0;

    let base = recipes
      .filter((r) => r.meal_type === mealType)
      .filter((r) => !used.has(r.id))
      .filter((r) => !dislikedIds.has(r.id))
      .filter((r) => !extraExclude.has(r.id))
      .filter((r) => !recipeContainsBlocked(r.id));

    if (!base.length) {
      base = recipes
        .filter((r) => r.meal_type === mealType)
        .filter((r) => !used.has(r.id))
        .filter((r) => !dislikedIds.has(r.id))
        .filter((r) => !recipeContainsBlocked(r.id));
    }

    if (!base.length) return null;

    let candidates = base;
    if (hard) {
      const strict = base.filter((r) => recipeHasAllDesired(r.id, desired));
      if (strict.length > 0) candidates = strict;
    }

    candidates.sort((a, b) => {
      const da = desiredMatchRatio(a.id, desired);
      const db = desiredMatchRatio(b.id, desired);
      const desiredBonusA = desired.size ? 0.35 * da : 0;
      const desiredBonusB = desired.size ? 0.35 * db : 0;

      const sa = (preferPantry ? matchRatio(a.id) : 0) + bonusFromPrefs(a.id) + desiredBonusA;
      const sb = (preferPantry ? matchRatio(b.id) : 0) + bonusFromPrefs(b.id) + desiredBonusB;

      if (sb !== sa) return sb - sa;
      return a.name.localeCompare(b.name);
    });

    const top = candidates.slice(0, Math.min(3, candidates.length));
    return top[Math.floor(Math.random() * top.length)].id;
  }

  function pickAlternativeRecipe(opts: {
    mealType: MealType;
    currentRecipeId: number;
    excludeRecipeIds: Set<number>;
    cooldownExclude: Set<number>;
    dislikedOverride?: Set<number>;
  }): number | null {
    const { mealType, currentRecipeId, excludeRecipeIds, cooldownExclude, dislikedOverride } = opts;

    const disliked = dislikedOverride ?? dislikedIds;
    const desired = desiredIdsSet;
    const hard = useIngredientIdsHard && desired.size > 0;

    const baseAllowed = (rid: number) =>
      rid !== currentRecipeId &&
      !excludeRecipeIds.has(rid) &&
      !disliked.has(rid) &&
      !cooldownExclude.has(rid) &&
      !recipeContainsBlocked(rid);

    let base = recipes.filter((r) => r.meal_type === mealType && baseAllowed(r.id));

    if (!base.length) {
      base = recipes
        .filter((r) => r.meal_type === mealType)
        .filter((r) => r.id !== currentRecipeId)
        .filter((r) => !excludeRecipeIds.has(r.id))
        .filter((r) => !disliked.has(r.id))
        .filter((r) => !recipeContainsBlocked(r.id));
    }

    if (!base.length) return null;

    let candidates = base;
    if (hard) {
      const strict = base.filter((r) => recipeHasAllDesired(r.id, desired));
      if (strict.length > 0) candidates = strict;
    }

    candidates.sort((a, b) => {
      const da = desiredMatchRatio(a.id, desired);
      const db = desiredMatchRatio(b.id, desired);
      const desiredBonusA = desired.size ? 0.35 * da : 0;
      const desiredBonusB = desired.size ? 0.35 * db : 0;

      const sa = (preferPantry ? matchRatio(a.id) : 0) + bonusFromPrefs(a.id) + desiredBonusA;
      const sb = (preferPantry ? matchRatio(b.id) : 0) + bonusFromPrefs(b.id) + desiredBonusB;

      if (sb !== sa) return sb - sa;
      return a.name.localeCompare(b.name);
    });

    const top = candidates.slice(0, Math.min(3, candidates.length));
    return top[Math.floor(Math.random() * top.length)].id;
  }

  async function refreshPlansList() {
    const { data: plans } = await supabase
      .from("meal_plans")
      .select("id,start_date,days_count,created_at")
      .order("created_at", { ascending: false });
    setAllPlans((plans ?? []) as MealPlan[]);
  }

  async function refreshPlan(planId: string) {
    const { data: plan } = await supabase
      .from("meal_plans")
      .select("id,start_date,days_count,created_at")
      .eq("id", planId)
      .single();

    const { data: s } = await supabase
      .from("meal_plan_slots")
      .select("id,date,meal_type,recipe_id,servings")
      .eq("meal_plan_id", planId);

    setActivePlan(plan as MealPlan);
    setSlots((s ?? []) as Slot[]);
  }

  async function setSlotRecipe(slot: Slot, recipeId: number): Promise<boolean> {
    if (!slot.id) return false;
    if (slot.servings === 0) return false;

    setSwappingSlotIds((prev) => {
      const next = new Set(prev);
      next.add(slot.id);
      return next;
    });

    try {
      const slotIdsToUpdate =
        slot.meal_type === "lunch" ? getLunchBlockSlotIdsToReplace(slot) : [slot.id];

      const { error } = await supabase
        .from("meal_plan_slots")
        .update({ recipe_id: recipeId })
        .in("id", slotIdsToUpdate);

      if (error) {
        console.error(error);
        alert("Błąd zapisu wyboru przepisu.");
        return false;
      }

      setSlots((prev) =>
        prev.map((s) => (slotIdsToUpdate.includes(s.id) ? { ...s, recipe_id: recipeId } : s))
      );

      return true;
    } finally {
      setSwappingSlotIds((prev) => {
        const next = new Set(prev);
        next.delete(slot.id);
        return next;
      });
    }
  }

  // -------- CREATE PLAN --------
  async function createPlan() {
    setBusy(true);

    const cd = Math.max(0, Math.floor(cooldownDays));
    const hasBlocked = blockedIngredientIds.size > 0;
    let blockedMiss = false;

    const queues = new Map<MealType, UseEntry[]>([
      ["breakfast", []],
      ["lunch", []],
      ["dinner", []],
    ]);

    if (cd > 0) {
      const fromDate = addDaysISO(startDate, -cd);

      const { data: hist } = await supabase
        .from("meal_plan_slots")
        .select("date,meal_type,recipe_id,servings")
        .gte("date", fromDate)
        .lt("date", startDate)
        .gt("servings", 0)
        .not("recipe_id", "is", null);

      for (const row of (hist ?? []) as SlotHistoryRow[]) {
        const mt = row.meal_type as MealType;
        const rid = Number(row.recipe_id);
        const d = String(row.date);
        const dist = diffDaysISO(startDate, d);
        if (!Number.isFinite(rid)) continue;
        if (dist <= 0) continue;
        queues.get(mt)!.push({ dayIndex: -dist, recipeId: rid });
      }
    }

    const { data: plan, error: planErr } = await supabase
      .from("meal_plans")
      .insert({ start_date: startDate, days_count: daysCount })
      .select("id,start_date,days_count,created_at")
      .single();

    if (planErr || !plan) {
      console.error(planErr);
      setBusy(false);
      return;
    }

    const planId = plan.id as string;

    const usedGlobal = new Set<number>();
    const newSlots: Omit<Slot, "id">[] = [];

    for (let day = 0; day < daysCount; day++) {
      const date = addDaysISO(startDate, day);

      // breakfast
      {
        const q = pruneQueue(queues.get("breakfast")!, day, cd);
        queues.set("breakfast", q);
        const cooldownExclude = cd > 0 ? queueToSet(q) : new Set<number>();

        const rid = pickRecipe("breakfast", usedGlobal, cooldownExclude);
        if (!rid && hasBlocked) blockedMiss = true;
        if (rid) {
          usedGlobal.add(rid);
          queues.get("breakfast")!.push({ dayIndex: day, recipeId: rid });
        }
        newSlots.push({ date, meal_type: "breakfast", recipe_id: rid, servings: people });
      }

      // lunch (resztki)
      if (lunchSpanDays <= 1) {
        const q = pruneQueue(queues.get("lunch")!, day, cd);
        queues.set("lunch", q);
        const cooldownExclude = cd > 0 ? queueToSet(q) : new Set<number>();

        const rid = pickRecipe("lunch", usedGlobal, cooldownExclude);
        if (!rid && hasBlocked) blockedMiss = true;
        if (rid) {
          usedGlobal.add(rid);
          queues.get("lunch")!.push({ dayIndex: day, recipeId: rid });
        }
        newSlots.push({ date, meal_type: "lunch", recipe_id: rid, servings: people });
      } else {
        if (day % lunchSpanDays === 0) {
          const q = pruneQueue(queues.get("lunch")!, day, cd);
          queues.set("lunch", q);
          const cooldownExclude = cd > 0 ? queueToSet(q) : new Set<number>();

          const rid = pickRecipe("lunch", usedGlobal, cooldownExclude);
          if (!rid && hasBlocked) blockedMiss = true;
          if (rid) {
            usedGlobal.add(rid);
            queues.get("lunch")!.push({ dayIndex: day, recipeId: rid });
          }

          newSlots.push({
            date,
            meal_type: "lunch",
            recipe_id: rid,
            servings: people * lunchSpanDays,
          });

          for (let k = 1; k < lunchSpanDays; k++) {
            if (day + k >= daysCount) break;
            const d2 = addDaysISO(startDate, day + k);
            newSlots.push({ date: d2, meal_type: "lunch", recipe_id: rid, servings: 0 });
          }
        }
      }

      // dinner
      {
        const q = pruneQueue(queues.get("dinner")!, day, cd);
        queues.set("dinner", q);
        const cooldownExclude = cd > 0 ? queueToSet(q) : new Set<number>();

        const rid = pickRecipe("dinner", usedGlobal, cooldownExclude);
        if (!rid && hasBlocked) blockedMiss = true;
        if (rid) {
          usedGlobal.add(rid);
          queues.get("dinner")!.push({ dayIndex: day, recipeId: rid });
        }
        newSlots.push({ date, meal_type: "dinner", recipe_id: rid, servings: people });
      }
    }

    if (blockedMiss && hasBlocked) {
      alert("Brak przepisu spełniającego wymagania (blokady produktów).");
    }

    const { error: slotsErr } = await supabase.from("meal_plan_slots").insert(
      newSlots.map((s) => ({
        meal_plan_id: planId,
        date: s.date,
        meal_type: s.meal_type,
        recipe_id: s.recipe_id,
        servings: s.servings,
      }))
    );

    if (slotsErr) {
      console.error(slotsErr);
      setBusy(false);
      return;
    }

    await refreshPlansList();
    await refreshPlan(planId);

    setSelectedPlanId(planId);
    router.push(`/meal-plan?plan=${planId}`);

    setBusy(false);
  }

  // --- update servings ---
  async function updateServings(slotId: string, servings: number) {
    setSlots((prev) => prev.map((s) => (s.id === slotId ? { ...s, servings } : s)));
    const { error } = await supabase.from("meal_plan_slots").update({ servings }).eq("id", slotId);
    if (error) console.error(error);
  }

  // --- lunch block replacement ---
  function getLunchBlockSlotIdsToReplace(target: Slot): string[] {
    const ids: string[] = [target.id];
    const oldRid = target.recipe_id;
    if (!oldRid) return ids;

    const sorted = [...slots].sort((a, b) => a.date.localeCompare(b.date));
    const idx = sorted.findIndex((s) => s.id === target.id);

    for (let i = idx + 1; i < sorted.length; i++) {
      const s = sorted[i];
      if (s.meal_type !== "lunch") continue;
      if (s.recipe_id !== oldRid) break;
      if (s.servings !== 0) break;
      ids.push(s.id);
    }
    return ids;
  }

  async function replaceSlot(slot: Slot, dislikedOverride?: Set<number>) {
    if (!slot.recipe_id) return;
    if (slot.servings === 0) return;

    setSwappingSlotIds((prev) => {
      const next = new Set(prev);
      next.add(slot.id);
      return next;
    });

    try {
      const used = new Set<number>();
      for (const s of slots) {
        if (s.recipe_id && s.servings > 0) used.add(s.recipe_id);
      }
      used.delete(slot.recipe_id);

      const cooldownExclude = getCooldownExcludeForSlot(slot);

      const newRecipeId = pickAlternativeRecipe({
        mealType: slot.meal_type,
        currentRecipeId: slot.recipe_id,
        excludeRecipeIds: used,
        cooldownExclude,
        dislikedOverride,
      });

      if (!newRecipeId) {
        if (blockedIngredientIds.size > 0) {
          alert("Brak przepisu spełniającego wymagania (blokady produktów).");
        } else {
          alert("Nie znalazłem alternatywnego przepisu.");
        }
        return;
      }

      const slotIdsToUpdate = slot.meal_type === "lunch" ? getLunchBlockSlotIdsToReplace(slot) : [slot.id];

      const { error } = await supabase
        .from("meal_plan_slots")
        .update({ recipe_id: newRecipeId })
        .in("id", slotIdsToUpdate);

      if (error) {
        console.error(error);
        alert("Błąd zapisu zamiany do bazy.");
        return;
      }

      setSlots((prev) =>
        prev.map((s) => (slotIdsToUpdate.includes(s.id) ? { ...s, recipe_id: newRecipeId } : s))
      );
    } finally {
      setSwappingSlotIds((prev) => {
        const next = new Set(prev);
        next.delete(slot.id);
        return next;
      });
    }
  }

  async function dislikeAndReplace(slot: Slot) {
    if (!slot.recipe_id) return;
    await setPreference(slot.recipe_id, "dislike");
    const override = new Set(dislikedIds);
    override.add(slot.recipe_id);
    await replaceSlot(slot, override);
  }

  async function toggleFavorite(slot: Slot) {
    if (!slot.recipe_id) return;
    const current = prefs.get(slot.recipe_id) ?? null;
    if (current === "favorite") await setPreference(slot.recipe_id, null);
    else await setPreference(slot.recipe_id, "favorite");
  }

  // --- index slots by date|meal ---
  const slotsIndex = useMemo(() => {
    const m = new Map<string, Slot>();
    for (const s of slots) m.set(`${s.date}|${s.meal_type}`, s);
    return m;
  }, [slots]);

  const days = useMemo(() => {
    if (!activePlan) return [];
    return Array.from({ length: activePlan.days_count }, (_, i) => addDaysISO(activePlan.start_date, i));
  }, [activePlan]);

  function goToPlan(planId: string) {
    setSelectedPlanId(planId);
    router.push(`/meal-plan?plan=${planId}`);
  }

  // --- DELETE PLAN ---
  async function deletePlan(planId: string) {
    const pl = allPlans.find((x) => x.id === planId);
    const name = pl ? planLabel(pl) : planId;

    const ok = window.confirm(`Czy na pewno chcesz usunąć plan: ${name}?\n\nTo usunie też wszystkie sloty planu.`);
    if (!ok) return;

    // usuń sloty, potem plan
    const { error: sErr } = await supabase.from("meal_plan_slots").delete().eq("meal_plan_id", planId);
    if (sErr) {
      console.error(sErr);
      alert("Nie udało się usunąć slotów planu (brak uprawnień / RLS?).");
      return;
    }

    const { error: pErr } = await supabase.from("meal_plans").delete().eq("id", planId);
    if (pErr) {
      console.error(pErr);
      alert("Nie udało się usunąć planu (brak uprawnień / RLS?).");
      return;
    }

    // odśwież listę i wybierz kolejny
    await refreshPlansList();

    // jeśli usunięty był aktywny
    if (selectedPlanId === planId) {
      // po refreshPlansList mamy nowe allPlans dopiero po renderze, więc pobierz listę na szybko:
      const { data: plans } = await supabase
        .from("meal_plans")
        .select("id,start_date,days_count,created_at")
        .order("created_at", { ascending: false });

      const next = (plans ?? [])[0]?.id ?? null;
      setSelectedPlanId(next);
      if (next) router.push(`/meal-plan?plan=${next}`);
      else router.push(`/meal-plan`);
    }
  }

  // --- HTML EXPORT ---
  function escapeHtml(s: string): string {
    return s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function buildIngredientsLine(recipeId: number, scale: number): string {
    const rows = recipeIngRowsByRecipe.get(recipeId) ?? [];
    const parts: string[] = [];

    const sorted = [...rows].sort((a, b) => {
      const an = ingredientsById.get(a.ingredient_id)?.name ?? "";
      const bn = ingredientsById.get(b.ingredient_id)?.name ?? "";
      return an.localeCompare(bn);
    });

    for (const row of sorted) {
      const ing = ingredientsById.get(row.ingredient_id);
      if (!ing) continue;

      const unit = row.unit ?? ing.unit ?? "";
      const amount = row.amount === null ? null : row.amount * scale;

      if (amount === null || amount === 0) {
        parts.push(`${ing.name}`);
      } else {
        parts.push(`${ing.name} ${fmtNumPL(amount)} ${unit}`.trim());
      }
    }

    return parts.join(", ");
  }

  function recipeSteps(recipeId: number): string[] {
    const r = recipesById.get(recipeId);
    const steps = Array.isArray(r?.steps) ? (r!.steps as string[]) : [];
    return steps.filter((x) => String(x).trim().length > 0);
  }

  function fileDownload(name: string, html: string) {
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function generateExportHtml(plan: MealPlan, planSlots: Slot[]) {
    // sort sloty po dacie
    const sortedSlots = [...planSlots].sort((a, b) => {
      const c = a.date.localeCompare(b.date);
      if (c !== 0) return c;
      return a.meal_type.localeCompare(b.meal_type);
    });

    const daysISO = Array.from({ length: plan.days_count }, (_, i) => addDaysISO(plan.start_date, i));

    // helper do pobierania slotu
    const getSlot = (date: string, mt: MealType) => sortedSlots.find((s) => s.date === date && s.meal_type === mt);

    // przypisz kody S1.., O1.., K1..
    const breakfastSlots = daysISO
      .map((d) => getSlot(d, "breakfast"))
      .filter((s): s is Slot => Boolean(s && s.recipe_id && s.servings > 0));

    const dinnerSlots = daysISO
      .map((d) => getSlot(d, "dinner"))
      .filter((s): s is Slot => Boolean(s && s.recipe_id && s.servings > 0));

    // lunch: bierzemy tylko dni gotowania (servings>0)
    const lunchCookSlots = daysISO
      .map((d) => getSlot(d, "lunch"))
      .filter((s): s is Slot => Boolean(s && s.recipe_id && s.servings > 0));

    const SCode = new Map<string, string>(); // slotId -> S#
    const KCode = new Map<string, string>();
    const OCodeByRecipeStart = new Map<string, string>(); // slotId(cook) -> O#

    breakfastSlots.forEach((s, i) => SCode.set(s.id, `S${i + 1}`));
    dinnerSlots.forEach((s, i) => KCode.set(s.id, `K${i + 1}`));
    lunchCookSlots.forEach((s, i) => OCodeByRecipeStart.set(s.id, `O${i + 1}`));

    // dla lunch leftover dni: znajdź najbliższy wcześniejszy cook slot z tym samym recipe_id
    function getLunchCodeForDay(date: string): { code: string | null; suffix: string | null } {
      const s = getSlot(date, "lunch");
      if (!s || !s.recipe_id) return { code: null, suffix: null };

      if (s.servings > 0) {
        // cook day
        const code = lunchCookSlots.find((x) => x.id === s.id) ? OCodeByRecipeStart.get(s.id)! : null;
        return { code, suffix: null };
      }

      // leftover day: szukamy wstecz
      const idx = daysISO.indexOf(date);
      if (idx < 0) return { code: null, suffix: null };

      let offset = 0;
      for (let i = idx - 1; i >= 0; i--) {
        const prev = getSlot(daysISO[i], "lunch");
        offset++;
        if (prev && prev.recipe_id === s.recipe_id && prev.servings > 0) {
          const code = OCodeByRecipeStart.get(prev.id) ?? null;
          return { code, suffix: leftoverOrdinalPL(offset) };
        }
        // jeżeli inny przepis po drodze, przerywamy
        if (prev && prev.recipe_id !== s.recipe_id) break;
      }

      return { code: null, suffix: "kolejny dzień" };
    }

    // rozpiska dni (Dzień 1: Sx, Oy, Kz)
    const planLines: string[] = [];
    for (let i = 0; i < daysISO.length; i++) {
      const d = daysISO[i];
      const b = getSlot(d, "breakfast");
      const l = getSlot(d, "lunch");
      const k = getSlot(d, "dinner");

      const sCode =
        b && b.recipe_id && b.servings > 0
          ? (SCode.get(b.id) ?? "")
          : b && b.servings === 0
          ? "S (resztki)"
          : "S?";

      const lunchInfo = l && l.recipe_id ? getLunchCodeForDay(d) : { code: null, suffix: null };
      const oCode = lunchInfo.code ? lunchInfo.code : "O?";
      const oSuffix = lunchInfo.suffix ? ` (${lunchInfo.suffix})` : "";

      const kCode =
        k && k.recipe_id && k.servings > 0
          ? (KCode.get(k.id) ?? "")
          : k && k.servings === 0
          ? "K (resztki)"
          : "K?";

      planLines.push(`<li><b>Dzień ${i + 1}:</b> ${escapeHtml(sCode)}, ${escapeHtml(oCode + oSuffix)}, ${escapeHtml(kCode)}</li>`);
    }

    // sekcje recipes
    function buildDetailsForSlot(code: string, slot: Slot, mealKind: "breakfast" | "lunch" | "dinner") {
      const rid = slot.recipe_id!;
      const r = recipesById.get(rid);
      const title = r?.name ?? `Przepis #${rid}`;
      const base = r?.base_servings && r.base_servings > 0 ? r.base_servings : 1;
      const scale = slot.servings / base;

      const ingLine = buildIngredientsLine(rid, scale);
      const steps = recipeSteps(rid);

      const portionsTxt = mealKind === "lunch" && slot.servings > 0 ? ` (${slot.servings} porcji)` : "";

      const stepsHtml = steps.length
        ? `<ol>${steps.map((s) => `<li>${escapeHtml(s)}</li>`).join("")}</ol>`
        : `<ol><li>(brak kroków w bazie)</li></ol>`;

      return `
  <details class="recipe">
    <summary><span class="dot"></span><p class="title">${escapeHtml(code)}. ${escapeHtml(title)}${escapeHtml(portionsTxt)}</p><div class="chev">⌄</div></summary>
    <div class="content">
      <div class="line"><span class="label">Składniki:</span> ${escapeHtml(ingLine)}</div>
      ${stepsHtml}
    </div>
  </details>`;
    }

    const breakfastDetails = breakfastSlots
      .map((s) => buildDetailsForSlot(SCode.get(s.id)!, s, "breakfast"))
      .join("\n");

    const lunchDetails = lunchCookSlots
      .map((s) => buildDetailsForSlot(OCodeByRecipeStart.get(s.id)!, s, "lunch"))
      .join("\n");

    const dinnerDetails = dinnerSlots
      .map((s) => buildDetailsForSlot(KCode.get(s.id)!, s, "dinner"))
      .join("\n");

    const title = `Jadłospis i przepisy – ${plan.days_count} dni`;
    const planName = `${planLabel(plan)}.html`;

    const lunchMeta =
      lunchSpanDays > 1
        ? `obiady – ${people * lunchSpanDays} porcji (każdy obiad na ${lunchSpanDays} dni)`
        : `obiady – ${people} porcje`;

    const metaLine = `
    <b>Porcje:</b> śniadania i kolacje – ${people} porcje, ${lunchMeta}.<br>
    Składniki i ilości są podane <b>po przecinku</b>.`;

    // HTML (styl jak podałeś)
    const html = `<!DOCTYPE html>
<html lang="pl">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<style>
  :root{
    --bg:#f6f7fb; --card:#ffffff; --text:#111827; --muted:#4b5563; --border:#e5e7eb;
    --b:#eef2ff; --b2:#6366f1;
    --l:#ecfeff; --l2:#06b6d4;
    --d:#f0fdf4; --d2:#22c55e;
    --shadow: 0 10px 28px rgba(17,24,39,.10);
    --radius: 16px;
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--text);font-family:system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif}
  .wrap{max-width:980px;margin:18px auto;padding:0 14px 24px}
  header{
    background:linear-gradient(135deg,#fff,#f8fafc);
    border:1px solid var(--border);
    border-radius:var(--radius);
    box-shadow:var(--shadow);
    padding:14px 14px 12px;
    margin-bottom:14px;
  }
  h1{margin:0 0 6px;font-size:18px}
  .meta{margin:0;color:var(--muted);font-size:13px;line-height:1.45}
  .tools{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}
  button{
    border:1px solid var(--border);
    background:#fff;
    color:var(--text);
    padding:9px 10px;
    border-radius:12px;
    font-weight:800;
    font-size:12px;
    cursor:pointer;
    box-shadow:0 6px 16px rgba(17,24,39,.06);
  }
  button.primary{background:#111827;color:#fff}

  .plan{
    border:1px solid var(--border);
    border-radius:var(--radius);
    background:var(--card);
    box-shadow:var(--shadow);
    padding:12px 14px;
    margin:14px 0;
  }
  .plan h2{margin:0 0 10px;font-size:14px}
  .plan ul{margin:0;padding-left:18px;color:var(--text);font-size:13px;line-height:1.55}
  .plan li{margin:6px 0}
  .tag{display:inline-block;font-size:12px;padding:3px 10px;border-radius:999px;border:1px solid var(--border);color:var(--muted);background:#fff;font-weight:800}

  .section{
    border:1px solid var(--border);
    border-radius:var(--radius);
    overflow:hidden;
    box-shadow:var(--shadow);
    margin:14px 0;
    background:var(--card);
  }
  .section-head{
    display:flex;align-items:center;justify-content:space-between;
    padding:12px 14px;
    font-weight:900;font-size:14px;
    border-bottom:1px solid var(--border);
  }
  .pill{
    font-size:12px;padding:4px 10px;border-radius:999px;border:1px solid var(--border);
    color:var(--muted);background:#fff;font-weight:800;
  }
  details.recipe{border-top:1px solid var(--border);background:#fff}
  details.recipe:first-of-type{border-top:none}
  summary{
    list-style:none;
    cursor:pointer;
    padding:12px 14px;
    display:grid;
    grid-template-columns:10px 1fr auto;
    gap:12px;
    align-items:start;
    user-select:none;
  }
  summary::-webkit-details-marker{display:none}
  .dot{width:10px;height:10px;border-radius:999px;margin-top:4px}
  .title{margin:0;font-weight:900;font-size:13.5px;line-height:1.25;white-space:normal;word-break:break-word}
  .chev{
    width:34px;height:26px;border-radius:10px;border:1px solid var(--border);
    display:flex;align-items:center;justify-content:center;background:#fff;color:var(--muted);
    transition:transform .15s ease;
  }
  details[open] summary .chev{transform:rotate(180deg)}
  .content{padding:0 14px 14px}
  .line{margin:10px 0 10px;font-size:13px;line-height:1.6}
  .label{font-weight:900}
  ol{margin:6px 0 0 18px;font-size:13px;line-height:1.6}
  li{margin:6px 0}
  .note{font-size:12px;color:var(--muted);margin-top:8px}

  .breakfast .section-head{background:var(--b)}
  .breakfast .dot{background:var(--b2)}
  .lunch .section-head{background:var(--l)}
  .lunch .dot{background:var(--l2)}
  .dinner .section-head{background:var(--d)}
  .dinner .dot{background:var(--d2)}

  @media (max-width:520px){
    summary{grid-template-columns:10px 1fr}
    .chev{display:none}
  }
</style>
</head>
<body>
<div class="wrap">

<header>
  <h1>${escapeHtml(title)} (${people} osoby)</h1>
  <p class="meta">${metaLine}</p>
  <div class="tools">
    <button class="primary" onclick="toggleAll(true)">Rozwiń wszystko</button>
    <button onclick="toggleAll(false)">Zwiń wszystko</button>
  </div>
</header>

<div class="plan">
  <h2>Rozpiska dni <span class="tag">${escapeHtml(planLabel(plan))}</span></h2>
  <ul>
    ${planLines.join("\n    ")}
  </ul>
</div>

<section class="section breakfast">
  <div class="section-head"><div>Śniadania (${breakfastSlots.length ? `S1–S${breakfastSlots.length}` : "S" })</div><div class="pill">indygo</div></div>
  ${breakfastDetails || ""}
</section>

<section class="section lunch">
  <div class="section-head"><div>Obiady (${lunchCookSlots.length ? `O1–O${lunchCookSlots.length}` : "O"}) – na ${lunchSpanDays} dni każdy</div><div class="pill">cyjan</div></div>
  ${lunchDetails || ""}
</section>

<section class="section dinner">
  <div class="section-head"><div>Kolacje (${dinnerSlots.length ? `K1–K${dinnerSlots.length}` : "K"})</div><div class="pill">zieleń</div></div>
  ${dinnerDetails || ""}
</section>

</div>
<script>
  function toggleAll(open){
    document.querySelectorAll('details.recipe').forEach(d => d.open = open);
    if(!open) window.scrollTo({top:0, behavior:"smooth"});
  }
</script>
</body>
</html>`;

    return { html, filename: planName };
  }

  async function downloadPlan(planId: string) {
    // jeśli to aktywny plan - użyj danych z pamięci
    if (activePlan && activePlan.id === planId) {
      const { html, filename } = generateExportHtml(activePlan, slots);
      fileDownload(filename, html);
      return;
    }

    // inaczej dociągnij z bazy
    const { data: pl, error: pErr } = await supabase
      .from("meal_plans")
      .select("id,start_date,days_count,created_at")
      .eq("id", planId)
      .single();

    if (pErr || !pl) {
      console.error(pErr);
      alert("Nie udało się pobrać planu do exportu.");
      return;
    }

    const { data: s, error: sErr } = await supabase
      .from("meal_plan_slots")
      .select("id,date,meal_type,recipe_id,servings")
      .eq("meal_plan_id", planId);

    if (sErr) {
      console.error(sErr);
      alert("Nie udało się pobrać slotów do exportu.");
      return;
    }

    const { html, filename } = generateExportHtml(pl as MealPlan, (s ?? []) as Slot[]);
    fileDownload(filename, html);
  }

  // --- UI derived ---
  const slotsIndexLocal = slotsIndex;

  if (loading) {
    return (
      <main style={{ maxWidth: 1200, margin: "20px auto", padding: 16 }}>
        <p>Ładowanie…</p>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 1200, margin: "20px auto", padding: 16 }}>
      <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
        {/* LEWA STRONA */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 style={{ fontSize: 22, fontWeight: 800 }}>Jadłospis</h1>

          <section style={{ marginTop: 12, border: "1px solid #ddd", borderRadius: 12, padding: 12 }}>
            <h2 style={{ fontSize: 16, fontWeight: 700 }}>Utwórz nowy plan</h2>

            <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
              <label>
                Data startu:{" "}
                <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              </label>

              <label>
                Liczba dni (1–31):{" "}
                <input
                  type="number"
                  min={1}
                  max={31}
                  value={daysCount}
                  onChange={(e) => setDaysCount(Number(e.target.value))}
                />
              </label>

              <label>
                Liczba osób (domyślne porcje na posiłek):{" "}
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={people}
                  onChange={(e) => setPeople(Number(e.target.value))}
                />
              </label>

              <label>
                Obiad gotuję na ile dni (np. 2 = gotuję raz, potem resztki):{" "}
                <input
                  type="number"
                  min={1}
                  max={7}
                  value={lunchSpanDays}
                  onChange={(e) => setLunchSpanDays(Number(e.target.value))}
                />
              </label>

              <label>
                Cooldown (nie powtarzaj przez X dni, 0 = wyłącz):{" "}
                <input
                  type="number"
                  min={0}
                  max={60}
                  value={cooldownDays}
                  onChange={(e) => setCooldownDays(Number(e.target.value))}
                />
              </label>

              {/* AUTOCOMPLETE */}
              <div style={{ position: "relative" }}>
                <label style={{ display: "block", marginBottom: 6, fontWeight: 700 }}>
                  Składniki do wykorzystania (po nazwie)
                </label>

                {selectedIngredients.length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
                    {selectedIngredients.map((ing) => (
                      <span
                        key={ing.id}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 6,
                          border: "1px solid #ddd",
                          borderRadius: 999,
                          padding: "6px 10px",
                          background: "#fafafa",
                        }}
                        title={`#${ing.id} • ${ing.category ?? "bez kategorii"}`}
                      >
                        {ing.name}
                        <button
                          onClick={() => removeSelectedIngredient(ing.id)}
                          style={{ border: "none", background: "transparent", cursor: "pointer" }}
                          title="Usuń"
                        >
                          ✕
                        </button>
                      </span>
                    ))}

                    <button onClick={clearSelectedIngredients} title="Wyczyść">
                      Wyczyść
                    </button>
                  </div>
                )}

                <input
                  value={ingredientQuery}
                  onChange={(e) => {
                    setIngredientQuery(e.target.value);
                    setIngredientSuggestOpen(true);
                  }}
                  onFocus={() => setIngredientSuggestOpen(true)}
                  onBlur={() => setTimeout(() => setIngredientSuggestOpen(false), 150)}
                  placeholder="Wpisz min. 2 litery, np. jaj, mle, chle…"
                  style={{ padding: 10, width: "100%" }}
                />

                {ingredientSuggestOpen && suggestions.length > 0 && (
                  <div
                    style={{
                      position: "absolute",
                      zIndex: 50,
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
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => addSelectedIngredient(ing.id)}
                        style={{
                          width: "100%",
                          textAlign: "left",
                          padding: 10,
                          border: "none",
                          background: "white",
                          cursor: "pointer",
                          borderBottom: "1px solid #eee",
                        }}
                        title={`Dodaj • #${ing.id}`}
                      >
                        <div style={{ fontWeight: 700 }}>{ing.name}</div>
                        <div style={{ opacity: 0.7, fontSize: 12 }}>
                          {ing.category ?? "bez kategorii"} • jednostka: {ing.unit} • ID: {ing.id}
                        </div>
                      </button>
                    ))}
                  </div>
                )}

                <div style={{ marginTop: 8, display: "flex", gap: 8, alignItems: "center" }}>
                  <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <input
                      type="checkbox"
                      checked={useIngredientIdsHard}
                      onChange={(e) => setUseIngredientIdsHard(e.target.checked)}
                    />
                    Tryb twardy: wymagaj wszystkich wybranych składników
                  </label>
                </div>
              </div>

              <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <input type="checkbox" checked={preferPantry} onChange={(e) => setPreferPantry(e.target.checked)} />
                Preferuj przepisy pasujące do Pantry
              </label>

              <button onClick={createPlan} disabled={busy}>
                {busy ? "Tworzę…" : "Utwórz plan"}
              </button>
            </div>
          </section>

          <section style={{ marginTop: 12, border: "1px solid #ddd", borderRadius: 12, padding: 12 }}>
            <h2 style={{ fontSize: 16, fontWeight: 700 }}>Sterowanie</h2>
            <p style={{ opacity: 0.8, margin: 0 }}>
              Swipe: <b>lewo</b> = zamień • <b>prawo</b> = 🚫 nie lubię + zamień • <b>Kroki ▼</b> = instrukcja.
            </p>
          </section>

          <section style={{ marginTop: 16 }}>
            <h2 style={{ fontSize: 16, fontWeight: 700 }}>Aktualny plan</h2>

            {!activePlan ? (
              <p style={{ opacity: 0.85 }}>Nie masz jeszcze planu. Utwórz nowy powyżej.</p>
            ) : (
              <>
                <p style={{ opacity: 0.8 }}>
                  Plan: <b>{planLabel(activePlan)}</b> • start: <b>{activePlan.start_date}</b> • dni:{" "}
                  <b>{activePlan.days_count}</b>
                </p>

                <div style={{ marginTop: 10, display: "grid", gap: 12 }}>
                  {days.map((date) => (
                    <div key={date} style={{ border: "1px solid #ddd", borderRadius: 12, padding: 12 }}>
                      <div style={{ fontWeight: 800, marginBottom: 8 }}>{date}</div>

                      {(["breakfast", "lunch", "dinner"] as MealType[]).map((mt) => {
                        const slot = slotsIndexLocal.get(`${date}|${mt}`);
                        const recipe = slot?.recipe_id ? recipesById.get(slot.recipe_id) : null;

                        const title = recipe ? recipe.name : "Brak przepisu";
                        const isLeftovers = slot ? slot.servings === 0 : false;
                        const isSwapping = slot ? swappingSlotIds.has(slot.id) : false;
                        const isSearchOpen = slot ? openSearchForSlotId === slot.id : false;
                        const searchResults = slot && isSearchOpen ? getRecipeCandidates(slot, searchQuery) : [];

                        const pref = slot?.recipe_id ? (prefs.get(slot.recipe_id) ?? null) : null;
                        const steps = Array.isArray(recipe?.steps) ? (recipe!.steps as string[]) : [];
                        const recipeId = recipe ? recipe.id : null;
                        const ingredientRows = recipeId ? recipeIngredientsByRecipe.get(recipeId) ?? [] : [];
                        const recipeBaseServings = recipe?.base_servings ?? null;

                        return (
                          <MealSlotRow
                            key={`${date}|${mt}|${recipeId ?? "none"}`}
                            slot={slot}
                            label={mealLabel(mt)}
                            title={title}
                            isLeftovers={isLeftovers}
                            isSwapping={isSwapping}
                            recipeId={recipeId}
                            steps={steps}
                            ingredientRows={ingredientRows}
                            recipeBaseServings={recipeBaseServings}
                            onReplace={(s) => replaceSlot(s)}
                            onDislikeAndReplace={dislikeAndReplace}
                            onToggleFavorite={toggleFavorite}
                            pref={pref}
                            onUpdateServings={updateServings}
                            onOpenSearch={openSearchPanel}
                            onCloseSearch={closeSearchPanel}
                            onSearchQueryChange={setSearchQuery}
                            onSelectSearchRecipe={async (targetSlot, newRecipeId) => {
                              const ok = await setSlotRecipe(targetSlot, newRecipeId);
                              if (ok) closeSearchPanel();
                            }}
                            searchOpen={isSearchOpen}
                            searchQuery={searchQuery}
                            searchResults={searchResults}
                            searchBusy={isSwapping}
                            searchDisabled={!slot || isLeftovers}
                          />
                        );
                      })}
                    </div>
                  ))}
                </div>
              </>
            )}
          </section>
        </div>

        {/* PRAWA STRONA: PANEL */}
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
            <button onClick={refreshPlansList} title="Odśwież listę" style={{ fontSize: 12, padding: "6px 8px" }}>
              Odśwież
            </button>
          </div>

          <div style={{ marginTop: 10, maxHeight: "70vh", overflowY: "auto", display: "grid", gap: 8 }}>
            {allPlans.length === 0 ? (
              <div style={{ opacity: 0.8 }}>Brak planów.</div>
            ) : (
              allPlans.map((pl) => {
                const isActive = pl.id === activePlan?.id;

                return (
                  <div
                    key={pl.id}
                    style={{
                      border: "1px solid #eee",
                      borderRadius: 10,
                      padding: 10,
                      background: isActive ? "#f3f7ff" : "white",
                      display: "grid",
                      gridTemplateColumns: "1fr auto",
                      gap: 10,
                      alignItems: "start",
                    }}
                  >
                    <button
                      onClick={() => goToPlan(pl.id)}
                      style={{
                        border: "none",
                        background: "transparent",
                        textAlign: "left",
                        padding: 0,
                        cursor: "pointer",
                      }}
                      title="Kliknij, aby przejść do tego planu"
                    >
                      <div style={{ fontWeight: 800 }}>{planLabel(pl)}</div>
                      <div style={{ opacity: 0.75, fontSize: 12, marginTop: 2 }}>
                        start: {pl.start_date} • dni: {pl.days_count}
                      </div>
                    </button>

                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <button
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          downloadPlan(pl.id);
                        }}
                        title="Pobierz HTML"
                        style={{ padding: "6px 8px", fontSize: 12 }}
                      >
                        ⬇️
                      </button>

                      <button
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          deletePlan(pl.id);
                        }}
                        title="Usuń plan"
                        style={{ padding: "6px 8px", fontSize: 12 }}
                      >
                        🗑
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </aside>
      </div>
    </main>
  );
}
