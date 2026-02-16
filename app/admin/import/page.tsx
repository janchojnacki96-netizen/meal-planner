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
    <main style={{ maxWidth: 760, margin: "20px auto", padding: 16 }}>
      <h1 style={{ fontSize: 22, fontWeight: 800 }}>Admin — Import CSV</h1>
      <p style={{ opacity: 0.8 }}>
        Import działa tylko dla kont z emailami wpisanymi w <code>ADMIN_EMAILS</code>.
      </p>

      <div style={{ display: "grid", gap: 12, marginTop: 12 }}>
        <label style={{ display: "grid", gap: 6 }}>
          <b>ingredients.csv</b>
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => setIngredients(e.target.files?.[0] ?? null)}
          />
        </label>

        <label style={{ display: "grid", gap: 6 }}>
          <b>recipes.csv</b>
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => setRecipes(e.target.files?.[0] ?? null)}
          />
        </label>

        <label style={{ display: "grid", gap: 6 }}>
          <b>recipe_ingredients.csv</b>
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => setRecipeIngredients(e.target.files?.[0] ?? null)}
          />
        </label>

        <button onClick={upload} disabled={busy}>
          {busy ? "Importuję…" : "Importuj"}
        </button>

        {msg && (
          <pre
            style={{
              marginTop: 6,
              whiteSpace: "pre-wrap",
              border: "1px solid #ddd",
              borderRadius: 10,
              padding: 10,
            }}
          >
            {msg}
          </pre>
        )}
      </div>
    </main>
  );
}
