export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { parse } from "csv-parse/sync";
import { createClient } from "@supabase/supabase-js";
import { createServerSupabase } from "@/lib/supabase/server";

type MealType = "breakfast" | "lunch" | "dinner";

function readCsvText(csvText: string) {
  return parse(csvText, {
    columns: true,
    skip_empty_lines: true,
    bom: true,
    trim: true,
  }) as Record<string, string>[];
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function normalizeMealType(raw: string): MealType {
  const x = (raw || "").trim().toLowerCase();
  if (x === "breakfast" || x === "sniadanie" || x === "śniadanie") return "breakfast";
  if (x === "lunch" || x === "obiad") return "lunch";
  if (x === "dinner" || x === "kolacja") return "dinner";
  throw new Error(`Nieznany meal_type: "${raw}"`);
}

function parseSteps(raw: string): string[] {
  const s = (raw || "").trim();
  if (!s) return [];
  return s.split("||").map((x) => x.trim()).filter(Boolean);
}

function parseTags(raw: string): string[] {
  const s = (raw || "").trim();
  if (!s) return [];
  return s.split("|").map((x) => x.trim()).filter(Boolean);
}

function isAdminEmail(email: string | null | undefined) {
  if (!email) return false;
  const list = (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
  return list.includes(email.toLowerCase());
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    message:
      "Endpoint działa. Użyj POST (multipart/form-data) z plikami: ingredients, recipes, recipe_ingredients.",
  });
}

export async function POST(req: Request) {
  try {
    // 1) Zalogowany user + admin check
	const supa = await createServerSupabase();
	const { data, error } = await supa.auth.getUser();


    if (error || !data.user) {
      return NextResponse.json({ error: "Brak zalogowanego użytkownika" }, { status: 401 });
    }
    if (!isAdminEmail(data.user.email)) {
      return NextResponse.json({ error: "Brak uprawnień admina" }, { status: 403 });
    }

    // 2) Pliki
    const form = await req.formData();
    const fIngredients = form.get("ingredients");
    const fRecipes = form.get("recipes");
    const fRecipeIngs = form.get("recipe_ingredients");

    if (!(fIngredients instanceof File) || !(fRecipes instanceof File) || !(fRecipeIngs instanceof File)) {
      return NextResponse.json(
        { error: "Brakuje plików. Wymagane: ingredients, recipes, recipe_ingredients" },
        { status: 400 }
      );
    }

    const [tIng, tRec, tRi] = await Promise.all([
      fIngredients.text(),
      fRecipes.text(),
      fRecipeIngs.text(),
    ]);

    // 3) Parsowanie CSV
    const ingredientsCsv = readCsvText(tIng);
    const recipesCsv = readCsvText(tRec);
    const recipeIngsCsv = readCsvText(tRi);

    const ingredients = ingredientsCsv.map((r, idx) => {
      const id = Number(r.id);
      if (!Number.isFinite(id)) throw new Error(`ingredients.csv: zły id w wierszu ${idx + 2}`);
      const name = (r.name || "").trim();
      const unit = (r.unit || "").trim() || "g";
      const category = (r.category || "").trim() || null;
      if (!name) throw new Error(`ingredients.csv: brak name w wierszu ${idx + 2}`);
      return { id, name, unit, category };
    });

    const recipes = recipesCsv.map((r, idx) => {
      const id = Number(r.id);
      if (!Number.isFinite(id)) throw new Error(`recipes.csv: zły id w wierszu ${idx + 2}`);
      const name = (r.name || "").trim();
      if (!name) throw new Error(`recipes.csv: brak name w wierszu ${idx + 2}`);

      const meal_type = normalizeMealType(r.meal_type);
      const base_servings = Number(r.base_servings || "1");
      if (!Number.isFinite(base_servings) || base_servings <= 0) {
        throw new Error(`recipes.csv: zły base_servings w wierszu ${idx + 2}`);
      }

      const steps = parseSteps(r.steps);
      const tags = parseTags(r.tags);

      return { id, name, meal_type, base_servings, steps, tags };
    });

    const recipeIngredients = recipeIngsCsv.map((r, idx) => {
      const recipe_id = Number(r.recipe_id);
      const ingredient_id = Number(r.ingredient_id);
      const amount = Number(r.amount);
      const unit = (r.unit || "").trim();

      if (!Number.isFinite(recipe_id)) throw new Error(`recipe_ingredients.csv: zły recipe_id w wierszu ${idx + 2}`);
      if (!Number.isFinite(ingredient_id)) throw new Error(`recipe_ingredients.csv: zły ingredient_id w wierszu ${idx + 2}`);
      if (!Number.isFinite(amount)) throw new Error(`recipe_ingredients.csv: zły amount w wierszu ${idx + 2}`);
      if (!unit) throw new Error(`recipe_ingredients.csv: brak unit w wierszu ${idx + 2}`);

      return { recipe_id, ingredient_id, amount, unit };
    });

    // 4) Admin klient Supabase
    const URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
    const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!URL || !KEY) {
      return NextResponse.json(
        { error: "Brakuje SUPABASE_URL lub SUPABASE_SERVICE_ROLE_KEY w env" },
        { status: 500 }
      );
    }

    const admin = createClient(URL, KEY, { auth: { persistSession: false } });

    // 5) Upsert
    for (const pack of chunk(ingredients, 500)) {
      const { error } = await admin.from("ingredients").upsert(pack, { onConflict: "id" });
      if (error) throw error;
    }

    for (const pack of chunk(recipes, 300)) {
      const { error } = await admin.from("recipes").upsert(pack, { onConflict: "id" });
      if (error) throw error;
    }

    for (const pack of chunk(recipeIngredients, 1000)) {
      const { error } = await admin
        .from("recipe_ingredients")
        .upsert(pack, { onConflict: "recipe_id,ingredient_id" });
      if (error) throw error;
    }

    // ✅ ZAWSZE zwracamy counts na sukcesie
    return NextResponse.json({
      ok: true,
      counts: {
        ingredients: ingredients.length,
        recipes: recipes.length,
        recipe_ingredients: recipeIngredients.length,
      },
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
