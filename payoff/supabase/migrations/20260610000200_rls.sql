-- ============================================================
-- Pay Off — Row Level Security
--
-- Principles:
--  * Members read/write only their own rows.
--  * ticket_ledger: members can READ their own entries; INSERTs
--    happen only through edge functions (service_role), never
--    from the client — caps are enforced server-side.
--  * drawings / earning_rules / lessons: readable by members,
--    writable only by admins.
--  * audit_log / amoe_entries: no client access; admins read audit.
-- ============================================================

create function public.is_admin()
returns boolean
language sql security definer set search_path = public
stable
as $$
  select coalesce((select is_admin from profiles where id = auth.uid()), false);
$$;

alter table profiles           enable row level security;
alter table debts              enable row level security;
alter table payments           enable row level security;
alter table earning_rules      enable row level security;
alter table ticket_ledger      enable row level security;
alter table drawings           enable row level security;
alter table payouts            enable row level security;
alter table lessons            enable row level security;
alter table lesson_completions enable row level security;
alter table amoe_entries       enable row level security;
alter table audit_log          enable row level security;

-- ------------------------------------------------ profiles
create policy "members read own profile"
  on profiles for select using (id = auth.uid() or is_admin());

create policy "members update own profile"
  on profiles for update using (id = auth.uid()) with check (id = auth.uid());

-- members may never grant themselves admin: column-level privileges
revoke update on profiles from authenticated;
grant update (first_name, last_initial, city, monthly_budget)
  on profiles to authenticated;

-- ------------------------------------------------ debts
create policy "members manage own debts"
  on debts for all using (member_id = auth.uid()) with check (member_id = auth.uid());

create policy "admins read debts"
  on debts for select using (is_admin());

-- ------------------------------------------------ payments
-- Payments are logged through the log-payment edge function so the
-- ticket engine runs atomically; clients can read their own history.
create policy "members read own payments"
  on payments for select using (member_id = auth.uid() or is_admin());

-- ------------------------------------------------ earning_rules
create policy "anyone authenticated reads active rules"
  on earning_rules for select using (true);

create policy "admins manage rules"
  on earning_rules for all using (is_admin()) with check (is_admin());

-- ------------------------------------------------ ticket_ledger
create policy "members read own ledger"
  on ticket_ledger for select using (member_id = auth.uid() or is_admin());
-- No insert/update/delete policies: writes go through edge functions
-- (service_role). The append-only trigger blocks mutation even there.

-- ------------------------------------------------ drawings
-- Members read via the drawings_public view (seed hidden until drawn).
create policy "admins manage drawings"
  on drawings for all using (is_admin()) with check (is_admin());

-- The base table is admin-only; expose the safe view instead.
revoke select on drawings from authenticated, anon;
grant select on drawings_public to authenticated, anon;
grant select on winners_feed to authenticated, anon;

-- ------------------------------------------------ payouts
create policy "members read own payouts"
  on payouts for select using (member_id = auth.uid() or is_admin());

-- Winner fills in creditor details to claim; the transition guard
-- trigger restricts the status path (pending_claim -> claimed).
create policy "winner claims own payout"
  on payouts for update
  using (member_id = auth.uid() and status = 'pending_claim')
  with check (member_id = auth.uid() and status = 'claimed');

create policy "admins manage payouts"
  on payouts for update using (is_admin()) with check (is_admin());

-- ------------------------------------------------ lessons
create policy "members read active lessons"
  on lessons for select using (active or is_admin());

create policy "admins manage lessons"
  on lessons for all using (is_admin()) with check (is_admin());

create policy "members read own lesson completions"
  on lesson_completions for select using (member_id = auth.uid() or is_admin());
-- Completions are inserted by the complete-lesson edge function so the
-- ticket grant and the completion stay atomic.

-- ------------------------------------------------ amoe_entries
-- Service-role only (public amoe-entry edge function). No client policies.

-- ------------------------------------------------ audit_log
create policy "admins read audit log"
  on audit_log for select using (is_admin());
