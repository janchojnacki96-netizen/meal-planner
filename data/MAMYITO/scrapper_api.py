import time
import json
import re
from pathlib import Path
from urllib.parse import urlencode
import pandas as pd
import requests

# --- KONFIGURACJA ---
# Ścieżka do pliku wynikowego CSV
OUT_CSV = r"C:\Users\jahon\meal-planner\data\MAMYITO\products.csv"

# Endpoint API
ENDPOINT_BASE = "https://api.mamyito.pl/api/products/list/99a2b89c-d8d3-4e49-871a-0ba169593073"
SHOP_BASE = "https://mamyito.pl" 

# Headers udające przeglądarkę
HEADERS = {
    "Accept": "application/json, text/plain, */*",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Safari/537.36",
    "Origin": SHOP_BASE,
    "Referer": SHOP_BASE + "/",
}

def clean_text(text):
    """Usuwa zbędne białe znaki."""
    if text is None:
        return ""
    return str(text).strip()

def format_price_num(value):
    """Zamienia liczbę (float) na format polski '12,99 zł'."""
    if value is None:
        return ""
    try:
        # Formatujemy do 2 miejsc po przecinku i zamieniamy kropkę na przecinek
        return f"{float(value):.2f}".replace('.', ',') + " zł"
    except (ValueError, TypeError):
        return str(value)

def clean_title_remove_producer(producer, title):
    """Usuwa nazwę producenta z początku tytułu (z Twojego oryginalnego kodu)."""
    if not producer or not title:
        return title
    
    p = str(producer).strip()
    t = str(title).strip()
    
    # Jeśli tytuł nie zaczyna się od producenta, zwróć bez zmian
    if not t.lower().startswith(p.lower()):
        return t

    # Regex usuwający producenta i ewentualne separatory na początku
    pattern = re.compile(rf"^\s*{re.escape(p)}\s*[-–—:,\|]*\s*", re.IGNORECASE)
    cleaned = pattern.sub("", t).strip()
    return cleaned or t

def get_nested(obj, path):
    """Bezpieczne pobieranie zagnieżdżonych kluczy, np. 'price.gross'."""
    parts = path.split('.')
    current = obj
    for p in parts:
        if isinstance(current, dict):
            current = current.get(p)
        else:
            return None
    return current

def extract_item_data(item: dict) -> dict:
    """
    Mapuje dane z JSON (Mamyito) na konkretne kolumny.
    """
    # 1. PRODUCER
    # W Twoim JSON producent jest w obiekcie 'producer' -> 'name'
    producer = get_nested(item, "producer.name")
    if not producer:
        # Fallback: czasem jest w 'manufacturer' lub 'brand'
        producer = get_nested(item, "manufacturer.name") or get_nested(item, "brand.name") or ""
    producer = clean_text(producer)

    # 2. TITLE
    title_raw = item.get("name", "")
    # Czyścimy tytuł z producenta
    title = clean_title_remove_producer(producer, title_raw)

    # 3. PRICE
    # Cena brutto jest w 'price.gross'
    price_val = get_nested(item, "price.gross")
    price_str = format_price_num(price_val)

    # 4. UNIT PRICE
    # W Twoim JSON jest pole 'unitPrice' które ma już gotowy string np. "26,63 zł / kg"
    unit_price = item.get("unitPrice", "")
    # Jeśli puste, spróbuj wyliczyć lub poszukać 'pricePerUnit'
    if not unit_price:
        unit_price = item.get("pricePerUnit", "")

    # 5. SIZE
    # Szukamy informacji o gramaturze. 
    # W JSON bywa 'info', 'shortDescription' lub po prostu trzeba wywnioskować z 'unit'.
    size = item.get("info", "") 
    if not size:
        # Często gramatura jest w 'shortDescription' jeśli 'info' jest puste
        size = item.get("shortDescription", "")
    
    # Jeśli nadal pusto, spróbujmy 'unit' (np. 'szt.', 'kg')
    if not size:
         size = item.get("unit", "")

    # 6. URL
    # Budujemy z 'slug'
    slug = item.get("slug")
    if slug:
        url = f"{SHOP_BASE}/produkt/{slug}"
    else:
        # Fallback
        url = item.get("url", "")

    return {
        "producer": producer,
        "title": clean_text(title),
        "size": clean_text(size),
        "price": price_str,
        "unit_price": clean_text(unit_price),
        "url": url
    }

def main():
    out_path = Path(OUT_CSV)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    session = requests.Session()
    session.headers.update(HEADERS)

    all_rows = []
    seen_ids = set() # Do unikania duplikatów po ID produktu
    
    page = 1
    limit = 60
    
    print(f"Rozpoczynam pobieranie z: {ENDPOINT_BASE}")

    while True:
        try:
            params = {"page": page, "limit": limit}
            print(f"Pobieranie strony {page}...", end=" ")
            
            resp = session.get(ENDPOINT_BASE, params=params, timeout=30)
            resp.raise_for_status()
            data = resp.json()

            # Wykrywanie listy produktów w JSON
            # W Twoim sample.json to po prostu lista (root list), ale w API paginowanym
            # często jest klucz 'items' lub 'data'. Ten kod obsługuje oba przypadki.
            items = []
            if isinstance(data, list):
                items = data
            elif isinstance(data, dict):
                # Szukamy klucza z listą
                items = data.get("items") or data.get("products") or data.get("data", [])
                if isinstance(items, dict) and "items" in items:
                    items = items["items"]
            
            if not items:
                print("-> Pusta lista lub brak klucza. Koniec.")
                break

            new_items_count = 0
            for item in items:
                # Unikalność po ID
                pid = item.get("id")
                if pid and pid in seen_ids:
                    continue
                if pid:
                    seen_ids.add(pid)

                row = extract_item_data(item)
                all_rows.append(row)
                new_items_count += 1

            print(f"Dodano: {new_items_count} produktów.")

            # Warunki końca pętli
            if new_items_count == 0 or len(items) < limit:
                print("Osiągnięto koniec listy produktów.")
                break
            
            # Limiter bezpieczeństwa (opcjonalnie można zwiększyć max_pages)
            if page >= 100: 
                print("Osiągnięto limit stron (safety break).")
                break

            page += 1
            time.sleep(0.2) # Krótka przerwa, żeby nie blokowali

        except Exception as e:
            print(f"\nBłąd podczas pobierania strony {page}: {e}")
            break

    # Zapis do CSV
    if all_rows:
        df = pd.DataFrame(all_rows)
        
        # Upewniamy się co do kolejności kolumn
        target_cols = ["producer", "title", "size", "price", "unit_price", "url"]
        # Jeśli jakiejś brakuje w danych, dodaj pustą
        for c in target_cols:
            if c not in df.columns:
                df[c] = ""
        
        df = df[target_cols]
        
        # Zapis: encoding='utf-8-sig' (dla polskich znaków w Excelu), sep=';' (dla kolumn w Excelu)
        df.to_csv(out_path, index=False, sep=';', encoding='utf-8-sig')
        
        print(f"\nSUKCES: Zapisano {len(df)} produktów do pliku:")
        print(str(out_path))
    else:
        print("\nNie znaleziono żadnych produktów.")

if __name__ == "__main__":
    main()