-- ---------------------------------------------------------------------------
-- The ledger document.
--
-- The relational tables below model the parts of the ledger worth querying:
-- transactions, commitments, goals, people, categories. They were never a
-- complete picture, and the gap was silent rather than obvious — a pull
-- rebuilt the ledger from those tables alone and handed back empty overtime
-- entries, empty receivables, empty planned transfers and empty categorisation
-- rules, having dropped the card correction note, each commitment's actual
-- paid amount, and the `commitId` that ties a settled bill to the expense that
-- settled it.
--
-- That last one is not a cosmetic loss. Without `commitId` the app cannot tell
-- that an expense was the rent it had already budgeted for, so it charges the
-- same rent twice: once as an obligation, once as discretionary spending.
--
-- `doc` closes the gap by storing the whole ledger in exactly the format the
-- backup file uses, so there is one serialisation to get right instead of two,
-- and the backup round-trip test covers sync as well.
--
-- The relational tables stay. They remain the queryable projection and they
-- keep older clients working; `doc` is the authority when present.
-- ---------------------------------------------------------------------------

alter table public.ledgers
  add column if not exists doc jsonb;

comment on column public.ledgers.doc is
  'The complete ledger, in the backup file format. Authoritative on pull; the '
  'relational tables are a queryable projection of the same data and are kept '
  'in step by the same push.';

alter table public.ledgers
  add column if not exists doc_version smallint;

comment on column public.ledgers.doc_version is
  'Schema version of `doc`, matching LEDGER_SCHEMA_VERSION in the app, so a '
  'pull can migrate a document written by an older build.';
