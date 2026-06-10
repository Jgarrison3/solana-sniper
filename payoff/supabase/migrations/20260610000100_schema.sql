-- ============================================================
-- Pay Off — core schema
-- "You win, even if you don't."
--
-- Design notes:
--  * ticket_ledger and audit_log are APPEND-ONLY, enforced by
--    triggers that reject UPDATE/DELETE for every role
--    (including service_role — corrections are made with
--    compensating entries, never edits).
--  * earning_rules carries a CHECK constraint making it
--    impossible to persist a rule that requires payment to the
--    app. Sweepstakes law hard rule: nothing purchasable may
--    ever grant tickets.
--  * Drawings get their RNG seed at INSERT time via trigger;
--    only the SHA-256 commitment is visible before the draw
--    (see drawings_public view) — provably fair.
-- ============================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------- enums

create type debt_type as enum
  ('credit_card', 'auto', 'student', 'personal', 'medical', 'other');

create type payment_source as enum
  ('self_reported', 'plaid'); -- TODO(plaid): 'plaid' unused until Plaid integration lands

create type drawing_status as enum
  ('open', 'closed', 'drawn', 'paid');

create type payout_status as enum
  ('pending_claim', 'claimed', 'payment_sent', 'confirmed');

-- ---------------------------------------------------------- profiles

create table profiles (
  id              uuid primary key references auth.users (id) on delete cascade,
  email           text,
  first_name      text,
  last_initial    text check (char_length(last_initial) <= 1),
  city            text,
  is_admin        boolean not null default false,
  monthly_budget  numeric(12,2) check (monthly_budget is null or monthly_budget >= 0),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- Auto-create a profile row for every new auth user.
create function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email) values (new.id, new.email);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------- debts

create table debts (
  id               uuid primary key default gen_random_uuid(),
  member_id        uuid not null references profiles (id) on delete cascade,
  nickname         text not null,
  type             debt_type not null,
  creditor_name    text not null,
  current_balance  numeric(12,2) not null check (current_balance >= 0),
  original_balance numeric(12,2) check (original_balance >= 0),
  apr              numeric(6,3) not null check (apr >= 0 and apr <= 100),
  minimum_payment  numeric(12,2) not null check (minimum_payment >= 0),
  due_day          smallint not null check (due_day between 1 and 31),
  monthly_payment  numeric(12,2) check (monthly_payment is null or monthly_payment >= 0),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index debts_member_idx on debts (member_id);

-- ---------------------------------------------------------- payments
-- Self-reported in MVP. `verified` + `source` exist now so
-- PlaidDebtProvider can slot in without a schema change.

create table payments (
  id          uuid primary key default gen_random_uuid(),
  member_id   uuid not null references profiles (id) on delete cascade,
  debt_id     uuid not null references debts (id) on delete cascade,
  amount      numeric(12,2) not null check (amount > 0),
  paid_at     date not null default current_date,
  on_time     boolean not null default true,
  verified    boolean not null default false,
  source      payment_source not null default 'self_reported',
  created_at  timestamptz not null default now()
);

create index payments_member_idx on payments (member_id, paid_at);
create index payments_debt_idx on payments (debt_id, paid_at);

-- ---------------------------------------------------------- earning_rules
-- Data-driven ticket engine. The edge functions read these rows;
-- nothing is hardcoded in app code.

create table earning_rules (
  id                       uuid primary key default gen_random_uuid(),
  code                     text not null unique,
  name                     text not null,
  description              text not null,
  base_tickets             integer not null check (base_tickets >= 0),
  -- 'event' grants base_tickets per qualifying event;
  -- 'dollars_extra' grants base_tickets per unit_size dollars above the minimum payment.
  unit                     text not null default 'event' check (unit in ('event', 'dollars_extra')),
  unit_size                numeric(12,2) check (unit_size is null or unit_size > 0),
  max_per_day              integer check (max_per_day is null or max_per_day > 0),
  max_per_month            integer check (max_per_month is null or max_per_month > 0),
  max_per_debt_per_month   integer check (max_per_debt_per_month is null or max_per_debt_per_month > 0),
  max_tickets_per_month    integer check (max_tickets_per_month is null or max_tickets_per_month > 0),
  once_per_debt            boolean not null default false,
  max_debts                integer check (max_debts is null or max_debts > 0),
  active                   boolean not null default true,
  config                   jsonb not null default '{}'::jsonb,
  -- HARD COMPLIANCE RULE: entries may never be purchasable.
  -- The CHECK makes a pay-to-enter rule unrepresentable.
  requires_payment_to_app  boolean not null default false,
  created_at               timestamptz not null default now(),
  constraint no_pay_to_play check (requires_payment_to_app = false)
);

-- ---------------------------------------------------------- drawings ("Payoff Drops")

create table drawings (
  id                   uuid primary key default gen_random_uuid(),
  name                 text not null,
  prize_amount         numeric(12,2) not null check (prize_amount > 0),
  sponsor_name         text not null,
  sponsor_blurb        text,
  opens_at             timestamptz not null,
  closes_at            timestamptz not null,
  drawn_at             timestamptz,
  status               drawing_status not null default 'open',
  winning_ticket_id    uuid, -- FK added after ticket_ledger exists
  rng_seed             text,        -- secret until drawn; exposed via drawings_public only after
  rng_seed_commitment  text,        -- sha256(rng_seed), public from creation — provably fair
  rng_proof            jsonb,       -- snapshot hash, total tickets, winning index, algorithm
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint drawing_window check (closes_at > opens_at)
);

create index drawings_status_idx on drawings (status, closes_at);

-- Generate + commit the seed the moment a drawing is created, so the
-- commitment is published before any tickets attach.
create function public.commit_drawing_seed()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.rng_seed is null then
    new.rng_seed := encode(gen_random_bytes(32), 'hex');
  end if;
  new.rng_seed_commitment := encode(digest(new.rng_seed, 'sha256'), 'hex');
  return new;
end;
$$;

create trigger drawings_commit_seed
  before insert on drawings
  for each row execute function public.commit_drawing_seed();

-- ---------------------------------------------------------- ticket_ledger
-- Append-only. Every grant is a row; tickets attach to the next
-- open drawing at grant time (drawing_id nullable when none open).

create table ticket_ledger (
  id          uuid primary key default gen_random_uuid(),
  member_id   uuid not null references profiles (id) on delete restrict,
  rule_id     uuid not null references earning_rules (id) on delete restrict,
  qty         integer not null check (qty > 0),
  drawing_id  uuid references drawings (id) on delete restrict,
  metadata    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index ticket_ledger_member_idx on ticket_ledger (member_id, created_at);
create index ticket_ledger_drawing_idx on ticket_ledger (drawing_id);

alter table drawings
  add constraint drawings_winning_ticket_fk
  foreign key (winning_ticket_id) references ticket_ledger (id);

-- Append-only enforcement — applies to ALL roles, service_role included.
create function public.raise_append_only()
returns trigger
language plpgsql
as $$
begin
  raise exception '% is append-only: % is not allowed', tg_table_name, tg_op;
end;
$$;

create trigger ticket_ledger_append_only
  before update or delete on ticket_ledger
  for each row execute function public.raise_append_only();

-- ---------------------------------------------------------- payouts (concierge payout tracking)
-- No money movement in MVP; the operator pays the creditor manually
-- and advances the status here.

create table payouts (
  id                 uuid primary key default gen_random_uuid(),
  drawing_id         uuid not null unique references drawings (id),
  member_id          uuid not null references profiles (id),
  amount             numeric(12,2) not null check (amount > 0),
  -- collected on the claim screen:
  creditor_name      text,
  account_reference  text,
  debt_id            uuid references debts (id),
  debt_type          debt_type,
  status             payout_status not null default 'pending_claim',
  claimed_at         timestamptz,
  sent_at            timestamptz,
  confirmed_at       timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index payouts_member_idx on payouts (member_id);

-- ---------------------------------------------------------- lessons

create table lessons (
  id         uuid primary key default gen_random_uuid(),
  slug       text not null unique,
  title      text not null,
  body       text not null,
  sort       integer not null default 0,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

create table lesson_completions (
  id            uuid primary key default gen_random_uuid(),
  member_id     uuid not null references profiles (id) on delete cascade,
  lesson_id     uuid not null references lessons (id),
  completed_on  date not null default current_date,
  created_at    timestamptz not null default now(),
  -- max one lesson reward per member per day
  constraint one_lesson_per_day unique (member_id, completed_on)
);

-- ---------------------------------------------------------- AMOE
-- Free alternative method of entry (legally required). Public web
-- endpoint, no app account needed. One entry per email per month.

create table amoe_entries (
  id              uuid primary key default gen_random_uuid(),
  email           text not null,
  full_name       text,
  postal_address  text,
  entry_month     date not null, -- first day of month
  member_id       uuid references profiles (id), -- linked when email matches a member
  created_at      timestamptz not null default now(),
  constraint one_amoe_per_email_per_month unique (email, entry_month)
);

-- ---------------------------------------------------------- audit_log
-- Append-only record of every drawing/payout state transition.

create table audit_log (
  id           bigint generated always as identity primary key,
  actor        uuid, -- null = system/cron
  entity_type  text not null,
  entity_id    text not null,
  action       text not null,
  from_status  text,
  to_status    text,
  metadata     jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);

create trigger audit_log_append_only
  before update or delete on audit_log
  for each row execute function public.raise_append_only();

-- ---------------------------------------------------------- status-transition guards + auditing

create function public.guard_drawing_transition()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if old.status is distinct from new.status then
    if not (
      (old.status = 'open'   and new.status = 'closed') or
      (old.status = 'closed' and new.status = 'drawn') or
      (old.status = 'drawn'  and new.status = 'paid')
    ) then
      raise exception 'invalid drawing status transition % -> %', old.status, new.status;
    end if;
    insert into audit_log (actor, entity_type, entity_id, action, from_status, to_status)
    values (auth.uid(), 'drawing', new.id::text, 'status_change', old.status::text, new.status::text);
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger drawings_guard_transition
  before update on drawings
  for each row execute function public.guard_drawing_transition();

create function public.guard_payout_transition()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if old.status is distinct from new.status then
    if not (
      (old.status = 'pending_claim' and new.status = 'claimed') or
      (old.status = 'claimed'       and new.status = 'payment_sent') or
      (old.status = 'payment_sent'  and new.status = 'confirmed')
    ) then
      raise exception 'invalid payout status transition % -> %', old.status, new.status;
    end if;

    if new.status = 'claimed' then
      new.claimed_at := now();
    elsif new.status = 'payment_sent' then
      new.sent_at := now();
    elsif new.status = 'confirmed' then
      new.confirmed_at := now();
      -- a confirmed payout completes the drawing
      update drawings set status = 'paid' where id = new.drawing_id and status = 'drawn';
    end if;

    insert into audit_log (actor, entity_type, entity_id, action, from_status, to_status)
    values (auth.uid(), 'payout', new.id::text, 'status_change', old.status::text, new.status::text);
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger payouts_guard_transition
  before update on payouts
  for each row execute function public.guard_payout_transition();

-- ---------------------------------------------------------- updated_at housekeeping

create function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_updated_at before update on profiles
  for each row execute function public.set_updated_at();
create trigger debts_updated_at before update on debts
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------- public views

-- Drawings as members may see them: the seed stays secret until drawn.
create view drawings_public as
select
  id, name, prize_amount, sponsor_name, sponsor_blurb,
  opens_at, closes_at, drawn_at, status, winning_ticket_id,
  rng_seed_commitment,
  case when status in ('drawn', 'paid') then rng_seed end as rng_seed,
  case when status in ('drawn', 'paid') then rng_proof end as rng_proof,
  created_at
from drawings;

-- Winners feed: "Jess T. · Tulsa · $2,500 sent to her auto loan"
create view winners_feed as
select
  pr.first_name,
  pr.last_initial,
  pr.city,
  p.amount,
  p.debt_type,
  d.name         as drawing_name,
  d.sponsor_name,
  p.confirmed_at
from payouts p
join drawings d on d.id = p.drawing_id
join profiles pr on pr.id = p.member_id
where p.status = 'confirmed';
