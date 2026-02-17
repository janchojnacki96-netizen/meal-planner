"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type ImportCounts = {
  ingredients: number;
  recipes: number;
  recipe_ingredients: number;
};

type ImportResponse = {
  counts?: ImportCounts;
  error?: string;
};

export default function AdminImportPage() {
  const supabase = createClient();
  const router = useRouter();

  const [ingredients, setIngredients] = useState<File | null>(null);
  const [recipes, setRecipes] = useState<File | null>(null);
  const [recipeIngredients, setRecipeIngredients] = useState<File | null>(null);

  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function ensureLoggedIn() {
    const { data } = await supabase.auth.getUser();
    if (!data.user) {
      router.push("/login");
      return false;
    }
    return true;
  }

  async function upload() {
    setMsg(null);

    if (!(await ensureLoggedIn())) return;

    if (!ingredients || !recipes || !recipeIngredients) {
      setMsg("Wybierz wszystkie 3 pliki CSV.");
      return;
    }

    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("ingredients", ingredients);
      fd.append("recipes", recipes);
      fd.append("recipe_ingredients", recipeIngredients);

      const res = await fetch("/api/admin/import-csv", {
        method: "POST",
        body: fd,
      });

      const contentType = res.headers.get("content-type") || "";
      const bodyText = await res.text();

      // Jeśli to JSON -> parsujemy, jeśli nie -> pokażemy tekst/HTML
      if (contentType.includes("application/json")) {
        let json: ImportResponse;
        try {
          json = JSON.parse(bodyText) as ImportResponse;
        } catch {
          setMsg(
            `Błąd (${res.status}): odpowiedź ma content-type JSON, ale nie da się jej sparsować.\n` +
              `Pierwsze znaki:\n${bodyText.slice(0, 300)}`
          );
          return;
        }

        if (!res.ok) {
          setMsg(`Błąd (${res.status}): ${json?.error ?? JSON.stringify(json)}`);
          return;
        }

        // sukces, ale różne możliwe odpowiedzi — obsługujemy bez wywalania się
        if (!json?.counts) {
          setMsg(
            "✅ Import zakończony, ale serwer nie zwrócił `counts`.\nOdpowiedź JSON:\n" +
              JSON.stringify(json, null, 2)
          );
          return;
        }

        setMsg(
          `✅ Zaimportowano: składniki=${json.counts.ingredients}, przepisy=${json.counts.recipes}, powiązania=${json.counts.recipe_ingredients}`
        );
        return;
      }

      // nie-JSON: zwykle HTML z 404/500
      setMsg(
        `Błąd (${res.status}): serwer zwrócił nie-JSON (${contentType || "brak content-type"}).\n` +
          `Pierwsze znaki odpowiedzi:\n${bodyText.slice(0, 300)}`
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold text-slate-900">Admin — Import CSV</h1>
        <p className="text-sm text-slate-600">
          Import działa tylko dla kont z emailami wpisanymi w <code className="rounded bg-slate-100 px-1">ADMIN_EMAILS</code>.
        </p>
      </header>

      <section className="card space-y-4">
        <label className="flex flex-col gap-2 text-sm font-semibold text-slate-700">
          ingredients.csv
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => setIngredients(e.target.files?.[0] ?? null)}
            className="input"
          />
        </label>

        <label className="flex flex-col gap-2 text-sm font-semibold text-slate-700">
          recipes.csv
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => setRecipes(e.target.files?.[0] ?? null)}
            className="input"
          />
        </label>

        <label className="flex flex-col gap-2 text-sm font-semibold text-slate-700">
          recipe_ingredients.csv
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => setRecipeIngredients(e.target.files?.[0] ?? null)}
            className="input"
          />
        </label>

        <button onClick={upload} disabled={busy} className="btn btn-primary">
          {busy ? "Importuję…" : "Importuj"}
        </button>

        {msg && (
          <pre className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
            {msg}
          </pre>
        )}
      </section>
    </main>
  );
}
