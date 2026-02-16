import fs from "fs";
import path from "path";
import dotenv from "dotenv";

dotenv.config({ path: path.join(process.cwd(), ".env.local") });

import { parse } from "csv-parse/sync";
import { createClient } from "@supabase/supabase-js";

type MealType = "breakfast" | "lunch" | "dinner";

function readCsv(filePath: string) {
  const content = fs.readFileSync(filePath, "utf-8");
  return parse(content, {
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

  throw new Error(`Nieznany meal_type: "${raw}" (dozwolone: breakfast/lunch/dinner lub sniadanie/obiad/kolacja)`);
}

function parseSteps(raw: string): string[] {
  const s = (raw || "").trim();
  if (!s) return [];
  // kroki rozdzielone podwójną kreską
  return s.split("||").map((x) => x.trim()).filter(Boolean);
}

function parseTags(raw: string): string[] {
  const s = (raw || "").trim();
  if (!s) return [];
  // tagi rozdzielone pojedynczą kreską
  return s.split("|").map((x) => x.trim()).filter(Boolean);
}

async function main() {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error("Brakuje SUPABASE_URL lub SUPABASE_SERVICE_ROLE_KEY w .env.local");
    process.exit(1);
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false },
  });

  const root = process.cwd();
  const ingredientsPath = path.join(root, "data", "ingredients.csv");
  const recipesPath = path.join(root, "data", "recipes.csv");
  const recipeIngsPath = path.join(root, "data", "recipe_ingredients.csv");

  if (!fs.existsSync(ingredientsPath) || !fs.existsSync(recipesPath) || !fs.existsSync(recipeIngsPath)) {
    console.error("Nie znaleziono plików CSV. Upewnij się, że istnieją:");
    console.error(" - data/ingredients.csv");
    console.error(" - data/recipes.csv");
    console.error(" - data/recipe_ingredients.csv");
    process.exit(1);
  }

  console.log("Czytam CSV…");

  const ingredientsCsv = readCsv(ingredientsPath);
  const recipesCsv = readCsv(recipesPath);
  const recipeIngsCsv = readCsv(recipeIngsPath);

  // --- INGREDIENTS ---
  const ingredients = ingredientsCsv.map((r, idx) => {
    const id = Number(r.id);
    if (!Number.isFinite(id)) throw new Error(`ingredients.csv: zły id w wierszu ${idx + 2}`);
    const name = (r.name || "").trim();
    const unit = (r.unit || "").trim() || "g";
    const category = (r.category || "").trim() || null;

    if (!name) throw new Error(`ingredients.csv: brak name w wierszu ${idx + 2}`);

    return { id, name, unit, category };
  });

  // --- RECIPES ---
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

  // --- RECIPE_INGREDIENTS ---
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

  console.log(`Składniki: ${ingredients.length}`);
  console.log(`Przepisy: ${recipes.length}`);
  console.log(`Powiązania: ${recipeIngredients.length}`);

  // Upsert w paczkach (żeby nie przekroczyć limitów)
  console.log("Import: ingredients…");
  for (const pack of chunk(ingredients, 500)) {
    const { error } = await supabase.from("ingredients").upsert(pack, { onConflict: "id" });
    if (error) throw error;
  }

  console.log("Import: recipes…");
  for (const pack of chunk(recipes, 300)) {
    const { error } = await supabase.from("recipes").upsert(pack, { onConflict: "id" });
    if (error) throw error;
  }

  console.log("Import: recipe_ingredients…");
  for (const pack of chunk(recipeIngredients, 1000)) {
    const { error } = await supabase
      .from("recipe_ingredients")
      .upsert(pack, { onConflict: "recipe_id,ingredient_id" });
    if (error) throw error;
  }

  console.log("✅ Import zakończony sukcesem.");
}

main().catch((e) => {
  console.error("❌ Import przerwany przez błąd:");
  console.error(e?.message ?? e);
  process.exit(1);
});
