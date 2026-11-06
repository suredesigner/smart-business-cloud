create table if not exists public.business_records (
  user_id uuid primary key references auth.users (id) on delete cascade,
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  updated_at timestamptz not null default now()
);

alter table public.business_records enable row level security;

drop policy if exists "Owners can read their business records" on public.business_records;
create policy "Owners can read their business records"
  on public.business_records for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Owners can create their business records" on public.business_records;
create policy "Owners can create their business records"
  on public.business_records for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Owners can update their business records" on public.business_records;
create policy "Owners can update their business records"
  on public.business_records for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create or replace function public.set_business_records_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = clock_timestamp();
  return new;
end;
$$;

drop trigger if exists set_business_records_updated_at on public.business_records;
create trigger set_business_records_updated_at
  before update on public.business_records
  for each row execute function public.set_business_records_updated_at();

grant select, insert, update on public.business_records to authenticated;
