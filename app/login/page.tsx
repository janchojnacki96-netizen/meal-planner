"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const supabase = createClient();
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"login" | "register">("login");
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    (async () => {
      const { data: userData } = await supabase.auth.getUser();
      if (!active) return;
      if (userData.user) {
        router.replace("/meal-plan");
      }
    })();

    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);

    if (mode === "register") {
      const { error } = await supabase.auth.signUp({ email, password });
      if (error) return setMsg(error.message);
      setMsg("Konto utworzone. Spróbuj się zalogować.");
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) return setMsg(error.message);
      router.push("/meal-plan");
      setMsg("Zalogowano ✅ (następnie zrobimy przekierowanie)");
    }
  }

  return (
    <main style={{ maxWidth: 420, margin: "40px auto", padding: 16 }}>
      <h1 style={{ fontSize: 24, fontWeight: 700 }}>Logowanie</h1>

      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <button onClick={() => setMode("login")} disabled={mode === "login"}>
          Logowanie
        </button>
        <button onClick={() => setMode("register")} disabled={mode === "register"}>
          Rejestracja
        </button>
      </div>

      <form onSubmit={onSubmit} style={{ display: "grid", gap: 10, marginTop: 16 }}>
        <input
          placeholder="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
        />
        <input
          placeholder="hasło"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          type="password"
          autoComplete={mode === "login" ? "current-password" : "new-password"}
        />
        <button type="submit">{mode === "login" ? "Zaloguj" : "Utwórz konto"}</button>
      </form>

      {msg && <p style={{ marginTop: 12 }}>{msg}</p>}
    </main>
  );
}
