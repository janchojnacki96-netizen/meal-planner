create table public.user_blocked_ingredients (
  user_id uuid not null references auth.users,
  ingredient_id int not null references public.ingredients(id),
  primary key (user_id, ingredient_id)
);

alter table public.user_blocked_ingredients enable row level security;

create policy "Select own blocked ingredients"
  on public.user_blocked_ingredients
  for select
  using (auth.uid() = user_id);

create policy "Insert own blocked ingredients"
  on public.user_blocked_ingredients
  for insert
  with check (auth.uid() = user_id);

create policy "Delete own blocked ingredients"
  on public.user_blocked_ingredients
  for delete
  using (auth.uid() = user_id);
