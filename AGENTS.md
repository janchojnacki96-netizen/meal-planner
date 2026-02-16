# Projekt: Meal planner (Next.js + Supabase)

## Stack
- Next.js (App Router), TypeScript
- Supabase (Auth + Postgres + RLS)
- UI: proste komponenty inline (bez Tailwinda)

## Ważne fakty o schemacie DB
- recipe_ingredients ma kolumny: recipe_id, ingredient_id, amount, unit (NIE quantity)
- meal_plans: id, start_date, days_count, created_at
- meal_plan_slots: meal_plan_id, date, meal_type, recipe_id, servings (servings=0 oznacza resztki)

## Strony
- /meal-plan — generowanie planu + swipe wymiana + eksport HTML + panel planów
- /shopping-list — sumowanie składników + extras + przenoszenie do pantry
- /pantry — produkty usera

## Komendy
- Start dev: npm run dev
- Build: npm run build
- Lint: npm run lint

## Zasady pracy agenta
- Zawsze pokazuj diff kluczowych plików i krótko opisz zmiany.
- Po zmianach uruchom npm run lint (i jeśli istnieją testy — testy).
- Nie commituj sekretów (.env.local).
- Nie zmieniaj schematu Supabase bez pytania.
