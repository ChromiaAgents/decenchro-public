-- The identity bridge between Supabase Auth and Neon Auth.
--
-- companies.owner_id used to be a foreign key into auth.users. Neon Auth issues
-- its own user ids in the neon_auth schema, and Supabase's bcrypt hashes cannot
-- be imported, so the 25 existing users arrive as strangers: same person, same
-- email, new id. Email is the only stable thing across the two systems.
--
-- Backfilled from auth.users during the data copy, then used once per user at
-- first sign-in to re-point companies.owner_id (and the matching
-- deployments.owner_id) at their Neon Auth id. That is what lets someone who
-- signed up with a password come back through Google and still own their agents.

alter table public.companies add column owner_email text;

create unique index companies_owner_email_key on public.companies (lower(owner_email));
