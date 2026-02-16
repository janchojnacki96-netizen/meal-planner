import re
import csv
import pandas as pd
import requests
from bs4 import BeautifulSoup
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed
import threading

from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry


# --- KONFIGURACJA ---
INPUT_CSV = r"C:\Users\jahon\meal-planner\data\MAMYITO\products.csv"
OUTPUT_CSV = r"C:\Users\jahon\meal-planner\data\MAMYITO\products_details_full.xlsx"
MAX_WORKERS = 100

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/122.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "pl-PL,pl;q=0.9,en-US;q=0.8,en;q=0.7",
}

thread_local = threading.local()


def make_session() -> requests.Session:
    s = requests.Session()
    s.headers.update(HEADERS)

    retry = Retry(
        total=4,
        backoff_factor=0.6,
        status_forcelist=[429, 500, 502, 503, 504],
        allowed_methods=["GET"],
        raise_on_status=False,
    )
    adapter = HTTPAdapter(max_retries=retry, pool_connections=20, pool_maxsize=20)
    s.mount("https://", adapter)
    s.mount("http://", adapter)
    return s


def get_session() -> requests.Session:
    if not hasattr(thread_local, "session"):
        thread_local.session = make_session()
    return thread_local.session


def clean_text(text) -> str:
    if not text:
        return ""
    return re.sub(r"\s+", " ", str(text)).strip()


def parse_float_pl(s: str):
    """
    '39,95' -> 39.95, '7.99' -> 7.99
    """
    if not s:
        return None
    s = clean_text(s)
    s = s.replace("\xa0", " ")
    m = re.search(r"(\d+(?:[.,]\d+)?)", s)
    if not m:
        return None
    num = m.group(1).replace(",", ".")
    try:
        return float(num)
    except Exception:
        return None


def read_csv_any_sep(path: Path) -> pd.DataFrame:
    try:
        return pd.read_csv(path, sep=";")
    except Exception:
        return pd.read_csv(path, sep=",")


# ---------- BREADCRUMBS (kategorie) ----------
def get_breadcrumbs(soup: BeautifulSoup) -> str:
    """
    Mamyito ma breadcrumbs jako serię linków zaczynających się od 'Wszystkie'
    (a nie jako klasy 'breadcrumb').
    Bierzemy pierwszy sensowny kontener, który ma: Wszystkie + min 2 kategorie
    i nie zawiera Logowanie/Rejestracja.
    """
    def is_bad_container_text(txt: str) -> bool:
        t = txt.lower()
        return ("logowanie" in t) or ("rejestracja" in t) or ("strefa niskich cen" in t)

    anchors = soup.find_all("a", href=True)
    for a in anchors:
        if clean_text(a.get_text()) != "Wszystkie":
            continue

        node = a
        for _ in range(6):
            parent = node.parent
            if not parent:
                break

            parent_txt = clean_text(parent.get_text(" ", strip=True))
            if is_bad_container_text(parent_txt):
                node = parent
                continue

            links = parent.find_all("a", href=True)
            texts = [clean_text(x.get_text(" ", strip=True)) for x in links]
            # szukamy: Wszystkie + coś dalej
            try:
                idx = next(i for i, t in enumerate(texts) if t.lower() == "wszystkie")
            except StopIteration:
                node = parent
                continue

            tail = [t for t in texts[idx + 1 :] if t]
            # wywal duplikaty zachowując kolejność
            out = []
            seen = set()
            for t in tail:
                key = t.lower()
                if key in seen:
                    continue
                seen.add(key)
                out.append(t)

            if len(out) >= 2:
                return " > ".join(out)

            node = parent

    # fallback: jeśli nie znaleziono — spróbuj zebrać pierwsze linki po title
    return ""


# ---------- SEKCJE OPIS / NUTRITION ----------
def find_heading(soup: BeautifulSoup, title_regex: str):
    return soup.find(
        lambda t: getattr(t, "name", None) in {"h1", "h2", "h3", "h4"}
        and re.search(title_regex, clean_text(t.get_text(" ", strip=True)), re.I)
    )


def extract_section_text(soup: BeautifulSoup, heading_regex: str) -> str:
    """
    Zbierz tekst od nagłówka sekcji do następnego nagłówka (h2/h3/h4).
    Bez śmieci z innych sekcji.
    """
    h = find_heading(soup, heading_regex)
    if not h:
        return ""

    parts = []
    for el in h.next_elements:
        if el == h:
            continue

        # stop na kolejnym nagłówku sekcji
        if getattr(el, "name", None) in {"h2", "h3", "h4"}:
            break

        # zbieramy tylko tekst z sensownych tagów
        if getattr(el, "name", None) in {"script", "style", "noscript"}:
            continue

        if isinstance(el, str):
            txt = clean_text(el)
            if not txt:
                continue
            # pomiń powtórki nagłówka
            if re.search(heading_regex, txt, re.I):
                continue
            parts.append(txt)

        # limit bezpieczeństwa
        if len(" ".join(parts)) > 2500:
            break

    # usuń duplikaty zachowując kolejność
    seen = set()
    out = []
    for p in parts:
        key = p.lower()
        if key not in seen:
            seen.add(key)
            out.append(p)

    return clean_text(" ".join(out))


def get_description(soup: BeautifulSoup) -> str:
    # bierzemy tylko sekcję "Opis produktu" (bez reszty strony)
    return extract_section_text(soup, r"Opis produktu")


def parse_nutrition_from_table(table) -> str:
    items = []
    for row in table.find_all("tr"):
        cols = [clean_text(c.get_text(" ", strip=True)) for c in row.find_all(["th", "td"])]
        cols = [c for c in cols if c]
        if len(cols) < 2:
            continue
        # pomiń nagłówki typu "Określenie | w 100g"
        if re.search(r"\bw\s*100", cols[-1], re.I) and re.search(r"określenie", cols[0], re.I):
            continue
        if re.search(r"\bw\s*100", cols[1], re.I):
            continue
        items.append(f"{cols[0]}: {cols[-1]}")
    return " | ".join(items)


def get_nutrition(soup: BeautifulSoup) -> str:
    h = find_heading(soup, r"Wartości odżywcze")
    if not h:
        return ""

    # 1) jeśli w obrębie sekcji jest tabela -> parsuj tabelę
    for el in h.next_elements:
        if el == h:
            continue
        if getattr(el, "name", None) in {"h2", "h3", "h4"}:
            break
        if getattr(el, "name", None) == "table":
            s = parse_nutrition_from_table(el)
            if s:
                return s

    # 2) fallback: parsuj linie tekstowe w sekcji
    lines = []
    for el in h.next_elements:
        if el == h:
            continue
        if getattr(el, "name", None) in {"h2", "h3", "h4"}:
            break
        if isinstance(el, str):
            txt = clean_text(el)
            if not txt:
                continue
            lines.append(txt)
        if len(lines) > 120:
            break

    pairs = []
    for line in lines:
        # pomijamy wstęp typu "Wartości odżywcze w 100 g"
        if re.search(r"wartości odżywcze w", line, re.I):
            continue
        if re.search(r"określenie", line, re.I) and re.search(r"w\s*100", line, re.I):
            continue
        m = re.match(r"^(.+?)\s+([0-9][0-9.,/ ]*[0-9])$", line)
        if m:
            label = clean_text(m.group(1))
            value = clean_text(m.group(2))
            pairs.append(f"{label}: {value}")

    return " | ".join(pairs)


# ---------- CENA / CENA JEDNOSTKOWA ----------
def get_price_info(soup: BeautifulSoup):
    """
    Parsuje blok:
      Cena aktualna
      7.99 zł / 1 szt.
      39,95 zł/kg
    """
    text = soup.get_text("\n", strip=True).replace("\xa0", " ")

    # Cena aktualna: X zł / 1 UNIT
    m = re.search(r"Cena aktualna\s*[\r\n]+(\d+(?:[.,]\d+)?)\s*zł\s*/\s*1\s*([^\r\n]+)", text, re.I)
    price_value = None
    price_unit = None
    if m:
        price_value = parse_float_pl(m.group(1))
        price_unit = clean_text(m.group(2)).replace(".", "").lower()

    # Cena jednostkowa: Y zł/kg lub Y zł/szt.
    m2 = re.search(r"(\d+(?:[.,]\d+)?)\s*zł\s*/\s*([a-zA-Ząćęłńóśźż.]+)", text)
    unit_price_value = None
    unit_price_unit = None
    if m2:
        unit_price_value = parse_float_pl(m2.group(1))
        unit_price_unit = clean_text(m2.group(2)).replace(".", "").lower()

    return {
        "price_value": price_value,
        "price_currency": "PLN" if price_value is not None else "",
        "price_unit": price_unit or "",
        "unit_price_value": unit_price_value,
        "unit_price_unit": unit_price_unit or "",
    }


def parse_size_from_title(soup: BeautifulSoup) -> str:
    t = soup.title.string if soup.title and soup.title.string else ""
    t = clean_text(t)
    # najczęściej: "... , 200 g | Mamyito.pl"
    m = re.search(r",\s*([0-9]+(?:[.,][0-9]+)?\s*(?:g|kg|ml|l|szt))\s*\|\s*Mamyito", t, re.I)
    return clean_text(m.group(1)) if m else ""


# ---------- SCRAPE ----------
def scrape_url(url: str, index: int):
    empty = {
        "categories": "",
        "description": "",
        "nutrition": "",
        "price_value": None,
        "price_currency": "",
        "price_unit": "",
        "unit_price_value": None,
        "unit_price_unit": "",
        "size_scraped": "",
    }

    if not url or "http" not in str(url):
        return index, empty

    try:
        session = get_session()
        resp = session.get(url, timeout=25)
        if resp.status_code != 200 or not resp.text:
            return index, empty

        soup = BeautifulSoup(resp.text, "html.parser")

        price = get_price_info(soup)

        data = {
            "categories": get_breadcrumbs(soup),
            "description": get_description(soup),
            "nutrition": get_nutrition(soup),
            "size_scraped": parse_size_from_title(soup),
            **price,
        }
        return index, data

    except Exception:
        return index, empty


def main():
    input_path = Path(INPUT_CSV)
    out_path = Path(OUTPUT_CSV)

    if not input_path.exists():
        print("Brak pliku wejściowego CSV.")
        return

    df = read_csv_any_sep(input_path)
    print(f"Start pobierania dla {len(df)} produktów. Wątki: {MAX_WORKERS}")

    results = [None] * len(df)

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        futures = []
        for i, row in df.iterrows():
            futures.append(executor.submit(scrape_url, row.get("url", ""), i))

        completed = 0
        for f in as_completed(futures):
            idx, data = f.result()
            results[idx] = data
            completed += 1
            if completed % 10 == 0:
                print(f"Pobrano: {completed}/{len(df)}", end="\r")

    print(f"\nPobieranie zakończone. Zapis do {out_path}...")

    details = pd.DataFrame(results)

    # upewnij się, że kolumny istnieją
    for col in ["categories", "description", "nutrition", "price", "unit_price", "size"]:
        if col not in df.columns:
            df[col] = ""

    # dodatkowe (strukturalne)
    for col in ["price_value", "price_currency", "price_unit", "unit_price_value", "unit_price_unit", "size_scraped"]:
        if col not in df.columns:
            df[col] = ""

    # wypełnianie: jeśli scraper zwrócił niepuste -> nadpisz
    def set_if_present_str(dst_col, src_col):
        src = details[src_col].fillna("").astype(str).str.strip()
        mask = src.ne("")
        df.loc[mask, dst_col] = src[mask]

    set_if_present_str("categories", "categories")
    set_if_present_str("description", "description")
    set_if_present_str("nutrition", "nutrition")

    # size: jeśli w input było puste, a scraper znalazł size_scraped -> ustaw
    if "size" in df.columns:
        src = details["size_scraped"].fillna("").astype(str).str.strip()
        mask = src.ne("") & df["size"].fillna("").astype(str).str.strip().eq("")
        df.loc[mask, "size"] = src[mask]

    # price i unit_price: ustawiamy w formacie czytelnym + zapisujemy też wartości liczbowe
    df["price_value"] = details["price_value"]
    df["price_currency"] = details["price_currency"]
    df["price_unit"] = details["price_unit"]
    df["unit_price_value"] = details["unit_price_value"]
    df["unit_price_unit"] = details["unit_price_unit"]

    # czytelne stringi do istniejących kolumn:
    # price = "7.99" (PLN), unit_price = "39,95 zł/kg"
    def fmt_price_val(v):
        if v is None or (isinstance(v, float) and pd.isna(v)):
            return ""
        return f"{v:.2f}"

    def fmt_unit_price(v, unit):
        if v is None or (isinstance(v, float) and pd.isna(v)) or not unit:
            return ""
        # dla PL lepiej z przecinkiem
        s = f"{v:.2f}".replace(".", ",")
        return f"{s} zł/{unit}"

    df["price"] = df["price_value"].apply(fmt_price_val)
    df["unit_price"] = [
        fmt_unit_price(v, u) for v, u in zip(df["unit_price_value"], df["unit_price_unit"])
    ]

    # zapis: XLSX
    df.to_excel(out_path, index=False, engine="openpyxl")
    print("Gotowe.")


if __name__ == "__main__":
    main()
