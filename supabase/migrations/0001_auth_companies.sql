-- decenchro — auth + company registration schema
-- Run this in the Supabase SQL editor (or via `supabase db push`) against your
-- project. `auth.users` is managed by Supabase; we only add the public table
-- that links a company profile to each authenticated user.

-- 1. Company profile: one row per signed-up user (the owner).
create table if not exists public.companies (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null unique references auth.users (id) on delete cascade,
  name        text not null check (char_length(trim(name)) between 1 and 120),
  description text not null default '' check (char_length(description) <= 2000),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.companies is
  'Company profile per authenticated user, captured at signup.';

-- 2. Row-level security: a user may only see and mutate their own company.
alter table public.companies enable row level security;

drop policy if exists "companies_select_own" on public.companies;
create policy "companies_select_own" on public.companies
  for select using (auth.uid() = owner_id);

drop policy if exists "companies_insert_own" on public.companies;
create policy "companies_insert_own" on public.companies
  for insert with check (auth.uid() = owner_id);

drop policy if exists "companies_update_own" on public.companies;
create policy "companies_update_own" on public.companies
  for update using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

drop policy if exists "companies_delete_own" on public.companies;
create policy "companies_delete_own" on public.companies
  for delete using (auth.uid() = owner_id);

-- 3. Keep updated_at honest.
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists companies_touch_updated_at on public.companies;
create trigger companies_touch_updated_at
  before update on public.companies
  for each row execute function public.touch_updated_at();

-- 4. On signup, create the company row from the metadata the signup form sends
--    (company_name / company_description in raw_user_meta_data). SECURITY DEFINER
--    so it runs as the table owner and bypasses RLS for this trusted insert.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.companies (owner_id, name, description)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'company_name'), ''), 'Untitled company'),
    coalesce(new.raw_user_meta_data ->> 'company_description', '')
  )
  on conflict (owner_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
