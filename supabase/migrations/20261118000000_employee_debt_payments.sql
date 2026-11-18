create or replace function public.record_team_debt_payment(
  p_workspace_id uuid,
  p_debt_id text,
  p_payment_id text,
  p_amount numeric,
  p_date date,
  p_note text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_username text;
  v_payload jsonb;
  v_debt jsonb;
  v_paid numeric;
  v_payment jsonb;
begin
  if auth.uid() is null then
    raise exception 'Sign in to record a debt payment.';
  end if;

  select member.username into v_username
  from public.team_members as member
  where member.workspace_id = p_workspace_id
    and member.user_id = auth.uid()
    and member.role = 'agent';

  if not found then
    raise exception 'Only an employee in this workspace can record a shared debt payment.';
  end if;

  if p_debt_id is null or length(p_debt_id) > 200
    or p_payment_id is null or length(p_payment_id) > 200
    or p_amount is null or p_amount <= 0
    or p_date is null
    or length(coalesce(p_note, '')) > 500 then
    raise exception 'The debt payment details are invalid.';
  end if;

  select shared.payload into v_payload
  from public.team_debt_records as shared
  where shared.workspace_id = p_workspace_id
  for update;

  if not found then
    raise exception 'The shared debt record could not be found.';
  end if;

  select debt.value into v_debt
  from jsonb_array_elements(v_payload) as debt(value)
  where debt.value ->> 'id' = p_debt_id;

  if v_debt is null then
    raise exception 'This debt no longer exists.';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(coalesce(v_debt -> 'payments', '[]'::jsonb)) as payment(value)
    where payment.value ->> 'id' = p_payment_id
  ) then
    return;
  end if;

  select coalesce(sum((payment.value ->> 'amount')::numeric), 0)
    into v_paid
  from jsonb_array_elements(coalesce(v_debt -> 'payments', '[]'::jsonb)) as payment(value);

  if p_amount > coalesce((v_debt ->> 'amount')::numeric, 0) - v_paid then
    raise exception 'The payment is greater than the remaining debt balance.';
  end if;

  v_payment := jsonb_build_object(
    'id', p_payment_id,
    'amount', p_amount,
    'date', p_date,
    'note', coalesce(p_note, ''),
    'by', v_username,
    'employee_id', auth.uid()
  );

  update public.team_debt_records as shared
  set payload = (
    select jsonb_agg(
      case
        when debt.value ->> 'id' = p_debt_id then
          jsonb_set(
            debt.value,
            '{payments}',
            coalesce(debt.value -> 'payments', '[]'::jsonb) || jsonb_build_array(v_payment),
            true
          )
        else debt.value
      end
      order by debt.ordinality
    )
    from jsonb_array_elements(v_payload) with ordinality as debt(value, ordinality)
  )
  where shared.workspace_id = p_workspace_id;
end;
$$;

revoke all on function public.record_team_debt_payment(uuid, text, text, numeric, date, text)
  from public, anon;
grant execute on function public.record_team_debt_payment(uuid, text, text, numeric, date, text)
  to authenticated;

create or replace function public.save_team_debts(
  p_workspace_id uuid,
  p_payload jsonb,
  p_expected_updated_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not exists (
    select 1
    from public.team_members as member
    where member.workspace_id = p_workspace_id
      and member.user_id = auth.uid()
      and member.role = 'admin'
  ) then
    raise exception 'Only this workspace owner can save shared debts.';
  end if;

  if p_payload is null or jsonb_typeof(p_payload) <> 'array' then
    raise exception 'The shared debt list is invalid.';
  end if;

  if p_expected_updated_at is null then
    insert into public.team_debt_records (workspace_id, payload)
    values (p_workspace_id, p_payload)
    on conflict (workspace_id) do nothing;
    if not found then
      raise exception 'Shared debts changed while saving. Try syncing again.';
    end if;
    return;
  end if;

  update public.team_debt_records
  set payload = p_payload
  where workspace_id = p_workspace_id
    and updated_at = p_expected_updated_at;

  if not found then
    raise exception 'Shared debts changed while saving. Try syncing again.';
  end if;
end;
$$;

revoke all on function public.save_team_debts(uuid, jsonb, timestamptz)
  from public, anon;
grant execute on function public.save_team_debts(uuid, jsonb, timestamptz)
  to authenticated;
