-- decenchro — Contact form submissions (the marketing "Contact us" modal).
-- The public /api/contact route inserts here via the service-role client. RLS is
-- on with NO policies, so anon/authenticated users can't read or write it; only
-- the service role (which bypasses RLS) can. View rows in the Supabase table
-- editor. Run in the Supabase SQL editor (or `supabase db push`).

create table if not exists public.contact_submissions (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  company    text,
  email      text not null,
  message    text not null,
  subject    text,
  created_at timestamptz not null default now()
);

alter table public.contact_submissions enable row level security;
-- No policies on purpose: service-role-only access.
