-- Masari — initial schema.
--
-- This replaces the prototype's model, in which the entire ledger lived in one
-- `masari_state` row keyed by a short "sync code", readable by anyone holding
-- that code plus the public anon key. Here every row carries a `user_id` and
-- row-level security makes the database itself enforce that a user can only
-- ever reach their own rows — the client is not trusted to filter.

-- ---------------------------------------------------------------------------
-- Profile: one row per authenticated user, holding preferences only.
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  lang         text        not null default 'ar' check (lang in ('ar', 'en')),
  theme        text        not null default 'light' check (theme in ('light', 'dark')),
  -- EGP per AED. Stored per user because everyone remits at a different rate.
  fx_rate      numeric(10, 4) not null default 13.6 check (fx_rate > 0),
  onboarded    boolean     not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Ledger: the account-level figures that are not themselves collections.
-- One per user.
-- ---------------------------------------------------------------------------
create table if not exists public.ledgers (
  user_id       uuid primary key references auth.users (id) on delete cascade,
  bank_open     numeric(14, 2) not null default 0,
  -- NULL is meaningful: the user has not opted into tracking cash at all,
  -- which the app shows differently from tracking it and holding zero.
  cash_open     numeric(14, 2),
  last_rec_str  text,
  base_salary   numeric(14, 2) not null default 0 check (base_salary >= 0),
  sal_status    text        not null default 'expected' check (sal_status in ('expected', 'received')),
  sal_actual    numeric(14, 2),
  card_limit    numeric(14, 2) not null default 0 check (card_limit >= 0),
  card_close_day smallint   not null default 1 check (card_close_day between 1 and 28),
  card_due_day  smallint    not null default 25 check (card_due_day between 1 and 28),
  -- Opening card position, captured once at setup. NULL until the card is set up.
  card_stmt0    numeric(14, 2),
  card_unbilled0 numeric(14, 2),
  card_inst_bal numeric(14, 2),
  card_inst_mo  numeric(14, 2),
  card_adj      numeric(14, 2) not null default 0,
  sav_target    numeric(14, 2),
  updated_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Collections. Each carries its own user_id so RLS can be enforced directly on
-- the row without a join back to the parent.
-- ---------------------------------------------------------------------------
create table if not exists public.categories (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  name_ar    text not null,
  name_en    text not null,
  -- Monthly budget; NULL means the category is not budgeted.
  budget     numeric(14, 2),
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.transactions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  occurred_at timestamptz not null,
  type       text not null check (type in (
               'income', 'expense', 'ccpay', 'debtpay', 'remit',
               'wd', 'dep', 'adjust', 'lend', 'borrow')),
  -- Set null rather than cascading: deleting a category must never delete the
  -- spending history that was filed under it.
  category_id uuid references public.categories (id) on delete set null,
  account    text check (account in ('bank', 'cash', 'card')),
  -- Unsigned for every type except `adjust`, which is a signed reconciliation
  -- correction and may legitimately be negative.
  amount     numeric(14, 2) not null,
  memo_ar    text,
  memo_en    text,
  -- false = already inside the opening reconciled balance; kept for history
  -- but must not be applied to the balance again.
  posts      boolean not null default true,
  person_id  uuid,
  purpose    text,
  created_at timestamptz not null default now(),
  constraint amount_sign_matches_type check (type = 'adjust' or amount >= 0)
);

create index if not exists transactions_user_time_idx
  on public.transactions (user_id, occurred_at desc);

create table if not exists public.commitments (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  name_ar    text not null,
  name_en    text not null,
  amount     numeric(14, 2),
  due_day    smallint check (due_day between 1 and 31),
  paused     boolean not null default false,
  paid_month boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.people (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  name       text not null,
  -- 'owe' = the user owes them; 'owed' = they owe the user.
  direction  text not null check (direction in ('owe', 'owed')),
  principal  numeric(14, 2) not null check (principal >= 0),
  outstanding numeric(14, 2) not null check (outstanding >= 0),
  from_account text check (from_account in ('bank', 'cash')),
  created_at timestamptz not null default now()
);

create table if not exists public.receivables (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  name_ar    text not null,
  name_en    text not null,
  amount     numeric(14, 2) not null check (amount >= 0),
  -- false renders the figure as an approximation in the UI.
  exact      boolean not null default true,
  status     text not null default 'expected' check (status in ('expected', 'received')),
  actual     numeric(14, 2),
  created_at timestamptz not null default now()
);

create table if not exists public.goals (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  name_ar    text not null,
  name_en    text not null,
  -- Which currency `target` is denominated in. The app converts EGP targets
  -- at the user's stored fx_rate.
  currency   text not null default 'AED' check (currency in ('AED', 'EGP')),
  target     numeric(14, 2),
  allocated  numeric(14, 2) not null default 0,
  months     integer check (months > 0),
  -- Money already held in Egypt, in EGP.
  external_egp numeric(14, 2) not null default 0,
  auto       boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.planned_transfers (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  amount     numeric(14, 2) not null check (amount >= 0),
  day        smallint check (day between 1 and 31),
  note       text,
  created_at timestamptz not null default now()
);

create table if not exists public.overtime_entries (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  worked_on  date not null,
  hours      numeric(6, 2) not null check (hours > 0),
  rate       numeric(10, 2) not null check (rate >= 0),
  multiplier numeric(4, 2) not null default 1.0 check (multiplier > 0),
  created_at timestamptz not null default now()
);

-- Merchant string -> category, learned when the user confirms a quick-add.
create table if not exists public.merchant_rules (
  user_id     uuid not null references auth.users (id) on delete cascade,
  merchant    text not null,
  category_id uuid references public.categories (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (user_id, merchant)
);

-- ---------------------------------------------------------------------------
-- Row-level security.
--
-- Every table is deny-by-default once RLS is enabled; the policies below are
-- the only way in. `(select auth.uid())` is wrapped in a subselect so Postgres
-- evaluates it once per statement instead of once per row.
--
-- The `with check` clause on writes is what stops a client from inserting or
-- updating a row that carries somebody else's user_id.
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
  tables text[] := array[
    'profiles', 'ledgers', 'categories', 'transactions', 'commitments',
    'people', 'receivables', 'goals', 'planned_transfers',
    'overtime_entries', 'merchant_rules'
  ];
begin
  foreach t in array tables loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);

    execute format('drop policy if exists %I on public.%I', t || '_select_own', t);
    execute format(
      'create policy %I on public.%I for select using ((select auth.uid()) = user_id)',
      t || '_select_own', t);

    execute format('drop policy if exists %I on public.%I', t || '_insert_own', t);
    execute format(
      'create policy %I on public.%I for insert with check ((select auth.uid()) = user_id)',
      t || '_insert_own', t);

    execute format('drop policy if exists %I on public.%I', t || '_update_own', t);
    execute format(
      'create policy %I on public.%I for update using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)',
      t || '_update_own', t);

    execute format('drop policy if exists %I on public.%I', t || '_delete_own', t);
    execute format(
      'create policy %I on public.%I for delete using ((select auth.uid()) = user_id)',
      t || '_delete_own', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Provision a profile and an empty ledger the moment a user signs up, so the
-- app never has to handle a half-existing account.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
-- Pinned search_path: a SECURITY DEFINER function that resolves unqualified
-- names through a caller-controlled search_path is a privilege-escalation hole.
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (user_id) values (new.id) on conflict do nothing;
  insert into public.ledgers (user_id) values (new.id) on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Keep `updated_at` honest so last-write-wins sync has something to compare.
-- ---------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

drop trigger if exists ledgers_touch on public.ledgers;
create trigger ledgers_touch before update on public.ledgers
  for each row execute function public.touch_updated_at();
