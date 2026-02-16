import asyncio
import re
from pathlib import Path

import pandas as pd
from playwright.async_api import async_playwright, TimeoutError as PlaywrightTimeoutError

URL = "https://mamyito.pl/produkty"
OUT_XLSX = r"C:\Users\jahon\meal-planner\data\MAMYITO\products.xlsx"

CLICK_TEXTS = [
    "Akceptuj",
    "Akceptuję",
    "Zgadzam",
    "Zezwól",
    "Rozumiem",
    "OK",
    "Zamknij",
]
CLICK_PATTERNS = [
    re.compile(rf"^\s*{re.escape(t)}(?:\s+.*)?$", re.I) for t in CLICK_TEXTS
]


async def close_common_overlays(page) -> None:
    # Best-effort: cookies/zgody/bannery
    for pattern in CLICK_PATTERNS:
        try:
            btn = page.get_by_role("button", name=pattern).first
            await btn.wait_for(state="visible", timeout=800)
            await btn.click(timeout=1500)
            await page.wait_for_timeout(300)
        except PlaywrightTimeoutError:
            pass
        except Exception:
            pass

    # Dodatkowe "close" po aria-label (czasem działa na popupy)
    for sel in ['[aria-label*="close" i]', '[aria-label*="zamknij" i]']:
        try:
            loc = page.locator(sel).first
            await loc.wait_for(state="visible", timeout=500)
            await loc.click(timeout=800)
            await page.wait_for_timeout(200)
        except PlaywrightTimeoutError:
            pass
        except Exception:
            pass


async def count_loaded_products(page) -> int:
    # Liczymy unikalne linki do produktów (heurystyka)
    return await page.evaluate(
        """
        () => {
          const isProductHref = (href) => {
            if (!href || typeof href !== "string") return false;
            if (!href.startsWith("/")) return false;
            if (href === "/produkty") return false;
            if (href.startsWith("/marki/")) return false;
            if (href.startsWith("/kategorie/")) return false;
            if (href.startsWith("/promocje")) return false;
            if (href.startsWith("/nowosci")) return false;
            if (href.startsWith("/bestsellery")) return false;
            if (href.length < 6 || !href.includes("-")) return false;
            return true;
          };

          const anchors = Array.from(document.querySelectorAll("a[href]"));
          const productAnchors = anchors.filter((a) => {
            const href = a.getAttribute("href");
            if (!isProductHref(href)) return false;
            const img = a.querySelector("img[alt]");
            if (!img) return false;
            const alt = (img.getAttribute("alt") || "").toLowerCase();
            if (alt.includes("logo")) return false;
            return true;
          });

          return new Set(productAnchors.map(a => a.getAttribute("href"))).size;
        }
        """
    )


async def scroll_to_load_all(page, max_rounds: int = 140, stable_rounds: int = 4, limit: int = None) -> int:
    last = 0
    stable = 0

    for _ in range(max_rounds):
        await close_common_overlays(page)

        try:
            current = await count_loaded_products(page)
        except Exception:
            current = last

        if current > last:
            last = current
            stable = 0
        else:
            stable += 1

        # Przerwij jeśli osiągnięto limit
        if limit and current >= limit:
            break

        if stable >= stable_rounds:
            break

        # scroll na dół
        await page.evaluate(
            """() => {
                const el = document.scrollingElement || document.documentElement;
                el.scrollTo(0, el.scrollHeight);
            }"""
        )

        # czas na doładowanie
        await page.wait_for_timeout(1000)

    return last


async def extract_products(page):
    # Zbieramy: title, producer(=marka), size, price, unit_price, url
    return await page.evaluate(
        """
        () => {
          const normalize = (s) => (s || "").replace(/\\s+/g, " ").trim();

          const isProductHref = (href) => {
            if (!href || typeof href !== "string") return false;
            if (!href.startsWith("/")) return false;
            if (href === "/produkty") return false;
            if (href.startsWith("/marki/")) return false;
            if (href.startsWith("/kategorie/")) return false;
            if (href.startsWith("/promocje")) return false;
            if (href.startsWith("/nowosci")) return false;
            if (href.startsWith("/bestsellery")) return false;
            if (href.length < 6 || !href.includes("-")) return false;
            return true;
          };

          const pickPrice = (text) => {
            // cena typu "12.34 zł" / "12,34 zł" ignorując jednostkowe "zł/kg", "zł/l" itd.
            const t = text || "";
            const re = /(\\d{1,4}(?:[.,]\\d{2})?)\\s*zł(?!\\s*\\/)/g;
            const m = re.exec(t);
            if (!m) return "";
            return m[0].replace(/\\s+/g, " ").trim(); // np. "12,34 zł"
          };

          const sizeTokenFrom = (s) => {
            const t = normalize(s);
            if (!t) return "";

            // multipack np. "6 x 330 ml"
            const mp = t.match(/\\b\\d+\\s*[x×]\\s*\\d+(?:[.,]\\d+)?\\s*(kg|g|l|ml)\\b/i);
            if (mp) return mp[0].replace(/\\s+/g, " ").trim();

            // zwykłe: "400 g", "1 kg", "0,5 l", "330 ml"
            const one = t.match(/\\b\\d+(?:[.,]\\d+)?\\s*(kg|g|l|ml)\\b/i);
            if (one) return one[0].replace(/\\s+/g, " ").trim();

            // sztuki: "10 szt"
            const szt = t.match(/\\b\\d+\\s*szt\\b/i);
            if (szt) return szt[0].replace(/\\s+/g, " ").trim();

            return "";
          };

          const unitPriceTokenFrom = (s) => {
            const t = normalize(s);
            if (!t) return "";

            // np. "21,87 zł/kg", "8.99 zł/l", czasem "21,87 zł / kg"
            const m = t.match(/\\b\\d{1,4}(?:[.,]\\d{2})\\s*zł\\s*\\/\\s*(kg|l|100\\s*g|100\\s*ml|szt)\\b/i);
            if (!m) return "";

            // ujednolicenie spacji
            return m[0]
              .replace(/\\s*\\/\\s*/g, "/")
              .replace(/\\s+/g, " ")
              .replace(/\\s*zł\\s*/i, " zł/")
              .replace(/\\/\\s*/g, "/")
              .trim();
          };

          const pickFromBadges = (tile, kind) => {
            // Szukamy krótkich elementów (badge) w kafelku:
            // - size: zawiera kg/g/ml/l i NIE zawiera "zł"
            // - unit_price: zawiera "zł/" i jednostkę
            const nodes = Array.from(tile.querySelectorAll("span, p, div, small"))
              .map(n => normalize(n.textContent))
              .filter(Boolean);

            let candidates = [];
            if (kind === "size") {
              candidates = nodes
                .filter(t => !/zł/i.test(t))
                .map(t => sizeTokenFrom(t))
                .filter(Boolean);
            } else if (kind === "unit_price") {
              candidates = nodes
                .map(t => unitPriceTokenFrom(t))
                .filter(Boolean);
            }

            if (!candidates.length) return "";

            // preferuj najkrótszy (badge zwykle jest krótki)
            candidates.sort((a, b) => a.length - b.length);
            return candidates[0];
          };

          const anchors = Array.from(document.querySelectorAll("a[href]")).filter((a) => {
            const href = a.getAttribute("href");
            if (!isProductHref(href)) return false;
            const img = a.querySelector("img[alt]");
            if (!img) return false;
            const alt = (img.getAttribute("alt") || "").toLowerCase();
            if (alt.includes("logo")) return false;
            return true;
          });

          const results = [];
          const seen = new Set();

          for (const a of anchors) {
            const href = a.getAttribute("href");
            if (seen.has(href)) continue;

            const tile =
              a.closest("article") ||
              a.closest("li") ||
              a.closest('[role="listitem"]') ||
              a.closest("div");

            if (!tile) continue;

            const brandA = tile.querySelector('a[href^="/marki/"]');
            const producer = normalize(brandA?.textContent || "");

            // tytuł: preferuj alt obrazka lub tekst linku
            const imgAlt = normalize(tile.querySelector("img[alt]")?.getAttribute("alt") || "");
            const titleText = normalize(a.textContent || "");
            const title = imgAlt || titleText;

            const tileText = tile.innerText || "";

            const price = pickPrice(tileText);

            // unit_price i size: preferuj badge, potem fallback z tekstu kafelka
            let unit_price = pickFromBadges(tile, "unit_price");
            if (!unit_price) unit_price = unitPriceTokenFrom(tileText);

            let size = pickFromBadges(tile, "size");
            if (!size) size = sizeTokenFrom(tileText);

            const url = new URL(href, location.origin).toString();

            seen.add(href);
            results.push({ title, producer, size, price, unit_price, url });
          }

          return results;
        }
        """
    )


def clean_title_remove_producer_prefix(producer: str, title: str) -> str:
    """
    Jeśli title zaczyna się od producer (case-insensitive), usuń ten prefix z title.
    Dodatkowo usuwa typowe separatory po marce: '-', '–', '—', ':', ',', '|'.
    """
    if not producer or not title:
        return title

    p = str(producer).strip()
    t = str(title).strip()
    if not p or not t:
        return title

    # Szybki check startswith (case-insensitive)
    if not t.lower().startswith(p.lower()):
        return title

    # Usuń producer z początku + opcjonalne separatory/spacje
    pattern = re.compile(rf"^\s*{re.escape(p)}\s*[-–—:,\|]*\s*", re.IGNORECASE)
    cleaned = pattern.sub("", t).strip()

    return cleaned or t


async def main(headful: bool = False, limit: int = None):
    out_path = Path(OUT_XLSX)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    async with async_playwright() as p:
        # Zawsze widoczna (tak jak w Twoim kodzie)
        browser = await p.chromium.launch(headless=False)
        context = await browser.new_context(locale="pl-PL", viewport={"width": 1280, "height": 900})
        page = await context.new_page()

        # Wejście na stronę
        await page.goto(URL, wait_until="domcontentloaded")
        await page.wait_for_timeout(800)
        await close_common_overlays(page)

        # Scroll do końca
        approx = await scroll_to_load_all(page, limit=limit)

        # Ekstrakcja
        products = await extract_products(page)

        await browser.close()

    # Dedup po URL
    seen = set()
    unique = []
    for p in products:
        u = (p.get("url") or "").strip()
        if not u or u in seen:
            continue
        seen.add(u)
        unique.append(p)

        # Przerwij jeśli osiągnięto limit
        if limit and len(unique) >= limit:
            break

    df = pd.DataFrame(unique)

    # Czyszczenie title: jeśli zaczyna się od producer, usuń prefix
    if "producer" in df.columns and "title" in df.columns:
        df["title"] = df.apply(
            lambda r: clean_title_remove_producer_prefix(r.get("producer"), r.get("title")),
            axis=1,
        )

    # Kolejność kolumn
    cols = [c for c in ["producer", "title", "size", "price", "unit_price", "url"] if c in df.columns]
    df = df[cols]

    # Zapis do XLSX
    df.to_excel(out_path, index=False)

    def n_missing(col):
        return int(df[col].isna().sum()) if col in df.columns else 0

    print(f"Załadowane (szacunek): {approx}")
    print(f"Zebrane (unikalne): {len(df)}")
    print(
        "Braki -> "
        f"producer: {n_missing('producer')}, "
        f"title: {n_missing('title')}, "
        f"size: {n_missing('size')}, "
        f"price: {n_missing('price')}, "
        f"unit_price: {n_missing('unit_price')}"
    )
    print(f"Zapisano: {out_path}")


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("--headful", action="store_true", help="Uruchom z widoczną przeglądarką (i tak jest widoczna)")
    parser.add_argument("--limit", type=int, default=None, help="Limit produktów do pobrania (None = wszystkie)")
    args = parser.parse_args()

    asyncio.run(main(headful=args.headful, limit=args.limit))
