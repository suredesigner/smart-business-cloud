create table if not exists public.team_workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 120),
  owner_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.team_members (
  user_id uuid primary key references auth.users (id) on delete cascade,
  workspace_id uuid not null references public.team_workspaces (id) on delete cascade,
  username text not null check (
    username = lower(username)
    and username ~ '^[a-z0-9][a-z0-9 ._-]{1,30}[a-z0-9]$'
  ),
  role text not null check (role in ('admin', 'agent')),
  created_at timestamptz not null default now(),
  unique (workspace_id, user_id)
);

create unique index if not exists team_members_workspace_role_username_idx
  on public.team_members (workspace_id, role, lower(username));

create table if not exists public.team_invites (
  code text primary key,
  workspace_id uuid not null,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  foreign key (workspace_id, created_by)
    references public.team_members (workspace_id, user_id) on delete cascade
);

alter table public.team_workspaces enable row level security;
alter table public.team_members enable row level security;
alter table public.team_invites enable row level security;

revoke all on public.team_workspaces, public.team_invites from anon, authenticated;
revoke all on public.team_members from anon, authenticated;
grant select on public.team_members to authenticated;

create or replace function public.is_team_workspace_member(
  p_workspace_id uuid,
  p_required_role text default null
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.team_members as member
    where member.workspace_id = p_workspace_id
      and member.user_id = (select auth.uid())
      and (p_required_role is null or member.role = p_required_role)
  );
$$;

revoke all on function public.is_team_workspace_member(uuid, text)
  from public, anon;
grant execute on function public.is_team_workspace_member(uuid, text)
  to authenticated;

drop policy if exists "Workspace members can read team members"
  on public.team_members;
create policy "Workspace members can read team members"
  on public.team_members for select to authenticated
  using (public.is_team_workspace_member(workspace_id));

create or replace function public.create_workspace(
  workspace_name text,
  member_username text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace_id uuid;
  v_username text;
begin
  if auth.uid() is null then
    raise exception 'Sign in before creating a team workspace.';
  end if;

  if exists (
    select 1 from public.team_members as member
    where member.user_id = auth.uid()
  ) then
    raise exception 'This cloud account already belongs to a team workspace.';
  end if;

  v_username := lower(trim(coalesce(member_username, '')));
  if v_username !~ '^[a-z0-9][a-z0-9 ._-]{1,30}[a-z0-9]$' then
    raise exception 'Enter a valid 3 to 32 character owner username.';
  end if;
  if length(trim(coalesce(workspace_name, ''))) not between 1 and 120 then
    raise exception 'Enter a business name between 1 and 120 characters.';
  end if;

  insert into public.team_workspaces (name, owner_id)
  values (trim(workspace_name), auth.uid())
  returning id into v_workspace_id;

  insert into public.team_members (user_id, workspace_id, username, role)
  values (auth.uid(), v_workspace_id, v_username, 'admin');

  return v_workspace_id;
end;
$$;

revoke all on function public.create_workspace(text, text)
  from public, anon;
grant execute on function public.create_workspace(text, text)
  to authenticated;

create or replace function public.join_workspace(
  invite_code text,
  member_username text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace_id uuid;
  v_username text;
begin
  if auth.uid() is null then
    raise exception 'Sign in before joining a team workspace.';
  end if;

  if exists (
    select 1 from public.team_members as member
    where member.user_id = auth.uid()
  ) then
    raise exception 'This cloud account already belongs to a team workspace.';
  end if;

  v_username := lower(trim(coalesce(member_username, '')));
  if v_username !~ '^[a-z0-9][a-z0-9 ._-]{1,30}[a-z0-9]$' then
    raise exception 'Enter a valid 3 to 32 character employee username.';
  end if;

  select invite.workspace_id into v_workspace_id
  from public.team_invites as invite
  where invite.code = upper(trim(coalesce(invite_code, '')));

  if not found then
    raise exception 'The employee access code is invalid.';
  end if;

  insert into public.team_members (user_id, workspace_id, username, role)
  values (auth.uid(), v_workspace_id, v_username, 'agent');

  return v_workspace_id;
end;
$$;

revoke all on function public.join_workspace(text, text)
  from public, anon;
grant execute on function public.join_workspace(text, text)
  to authenticated;

create or replace function public.create_team_invite()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace_id uuid;
  v_code text;
begin
  select member.workspace_id into v_workspace_id
  from public.team_members as member
  where member.user_id = auth.uid()
    and member.role = 'admin';

  if not found then
    raise exception 'Only a workspace owner can create an employee access code.';
  end if;

  v_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 20));
  insert into public.team_invites (code, workspace_id, created_by)
  values (v_code, v_workspace_id, auth.uid());
  return v_code;
end;
$$;

revoke all on function public.create_team_invite()
  from public, anon;
grant execute on function public.create_team_invite()
  to authenticated;

create table if not exists public.employee_comments (
  id text primary key,
  workspace_id uuid not null references public.team_workspaces (id) on delete cascade,
  employee_id uuid not null,
  owner_id uuid not null references auth.users (id) on delete cascade,
  owner_username text not null,
  body text not null check (length(body) between 1 and 2000),
  created_at timestamptz not null default now(),
  foreign key (workspace_id, employee_id)
    references public.team_members (workspace_id, user_id) on delete cascade
);

alter table public.employee_comments enable row level security;
revoke all on public.employee_comments from anon, authenticated;
grant select, insert on public.employee_comments to authenticated;

drop policy if exists "Workspace members can read their employee comments"
  on public.employee_comments;
create policy "Workspace members can read their employee comments"
  on public.employee_comments for select to authenticated
  using (
    public.is_team_workspace_member(workspace_id, 'admin')
    or (
      public.is_team_workspace_member(workspace_id, 'agent')
      and employee_id = (select auth.uid())
    )
  );

drop policy if exists "Workspace owners can add employee comments"
  on public.employee_comments;
create policy "Workspace owners can add employee comments"
  on public.employee_comments for insert to authenticated
  with check (
    public.is_team_workspace_member(workspace_id, 'admin')
    and owner_id = (select auth.uid())
    and exists (
      select 1 from public.team_members as employee
      where employee.workspace_id = employee_comments.workspace_id
        and employee.user_id = employee_comments.employee_id
        and employee.role = 'agent'
    )
    and owner_username = (
      select member.username
      from public.team_members as member
      where member.workspace_id = employee_comments.workspace_id
        and member.user_id = (select auth.uid())
    )
  );

create table if not exists public.product_photos (
  id text primary key,
  workspace_id uuid not null references public.team_workspaces (id) on delete cascade,
  product_name text not null check (length(product_name) between 1 and 120),
  category text not null default '' check (length(category) <= 80),
  image text not null check (
    length(image) <= 8388608
    and image ~ '^data:image/(jpeg|png|webp|gif);base64,[A-Za-z0-9+/=]+$'
  ),
  added_by uuid not null,
  updated_at timestamptz not null default now(),
  foreign key (workspace_id, added_by)
    references public.team_members (workspace_id, user_id) on delete cascade
);

create index if not exists product_photos_workspace_updated_idx
  on public.product_photos (workspace_id, updated_at desc);

alter table public.product_photos enable row level security;
revoke all on public.product_photos from anon, authenticated;
grant select, insert, update on public.product_photos to authenticated;

drop policy if exists "Workspace members can read product photos"
  on public.product_photos;
create policy "Workspace members can read product photos"
  on public.product_photos for select to authenticated
  using (public.is_team_workspace_member(workspace_id));

drop policy if exists "Workspace members can add product photos"
  on public.product_photos;
create policy "Workspace members can add product photos"
  on public.product_photos for insert to authenticated
  with check (
    public.is_team_workspace_member(workspace_id)
    and added_by = (select auth.uid())
  );

drop policy if exists "Photo owners can update their product photos"
  on public.product_photos;
create policy "Photo owners can update their product photos"
  on public.product_photos for update to authenticated
  using (
    public.is_team_workspace_member(workspace_id)
    and added_by = (select auth.uid())
  )
  with check (
    public.is_team_workspace_member(workspace_id)
    and added_by = (select auth.uid())
  );

create or replace function public.set_product_photos_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = clock_timestamp();
  return new;
end;
$$;

drop trigger if exists set_product_photos_updated_at on public.product_photos;
create trigger set_product_photos_updated_at
  before update on public.product_photos
  for each row execute function public.set_product_photos_updated_at();
