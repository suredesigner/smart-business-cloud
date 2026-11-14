create table if not exists public.team_debt_records (
  workspace_id uuid primary key,
  payload jsonb not null default '[]'::jsonb
    check (jsonb_typeof(payload) = 'array'),
  updated_at timestamptz not null default now()
);

alter table public.team_debt_records enable row level security;

drop policy if exists "Workspace members can read shared debts"
  on public.team_debt_records;
create policy "Workspace members can read shared debts"
  on public.team_debt_records for select to authenticated
  using (
    exists (
      select 1
      from public.team_members member
      where member.workspace_id = team_debt_records.workspace_id
        and member.user_id = (select auth.uid())
        and member.role in ('admin', 'agent')
    )
  );

drop policy if exists "Workspace owners can create shared debts"
  on public.team_debt_records;
create policy "Workspace owners can create shared debts"
  on public.team_debt_records for insert to authenticated
  with check (
    exists (
      select 1
      from public.team_members member
      where member.workspace_id = team_debt_records.workspace_id
        and member.user_id = (select auth.uid())
        and member.role = 'admin'
    )
  );

drop policy if exists "Workspace owners can update shared debts"
  on public.team_debt_records;
create policy "Workspace owners can update shared debts"
  on public.team_debt_records for update to authenticated
  using (
    exists (
      select 1
      from public.team_members member
      where member.workspace_id = team_debt_records.workspace_id
        and member.user_id = (select auth.uid())
        and member.role = 'admin'
    )
  )
  with check (
    exists (
      select 1
      from public.team_members member
      where member.workspace_id = team_debt_records.workspace_id
        and member.user_id = (select auth.uid())
        and member.role = 'admin'
    )
  );

create or replace function public.set_team_debt_records_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = clock_timestamp();
  return new;
end;
$$;

drop trigger if exists set_team_debt_records_updated_at
  on public.team_debt_records;
create trigger set_team_debt_records_updated_at
  before update on public.team_debt_records
  for each row execute function public.set_team_debt_records_updated_at();

grant select, insert, update on public.team_debt_records to authenticated;
