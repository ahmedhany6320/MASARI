-- ---------------------------------------------------------------------------
-- Scheduling fields.
--
-- Three additions, each backing a correctness fix in the app rather than a new
-- feature:
--
--   commitments.paid_for  — the cycle a commitment was settled for. The old
--                           `paid_month` boolean carried no cycle and nothing
--                           ever cleared it, so a bill ticked once stayed
--                           ticked forever and silently left the daily limit.
--   ledgers.card_setup_at — when the opening card figures were declared, so
--                           the installment plan can be amortised forward
--                           instead of sitting frozen at its opening balance.
--   ledgers.ssl_basis     — whether the daily limit is sized from the salary
--                           cycle or from the balance actually held.
--
-- All three are nullable or defaulted, so an existing row stays valid and an
-- older client that does not know about them keeps working unchanged.
-- ---------------------------------------------------------------------------

alter table public.commitments
  add column if not exists paid_for text
    check (paid_for is null or paid_for ~ '^\d{4}-\d{2}$');

comment on column public.commitments.paid_for is
  'Cycle this was last marked paid for, as YYYY-MM. Supersedes paid_month, which is retained only for older clients.';

alter table public.ledgers
  add column if not exists card_setup_at timestamptz;

alter table public.ledgers
  add column if not exists ssl_basis text not null default 'salary'
    check (ssl_basis in ('salary', 'balance'));
