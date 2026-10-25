# Architecture decision records

Each file here records one decision that shaped the system, in four parts: **Context** (the forces and the failure that motivated it), **Decision**, **Consequences** (what got better and what it costs) and **Evidence** (paths in this repository that back every technical claim). They are written retrospectively from the code, the migration headers and the tests, and all are *Accepted*. Each fits on one page and stands alone.

| # | Decision | In one line |
|---|---|---|
| [0001](0001-rls-roles-and-column-allowlists.md) | RLS, fail-closed roles, column allowlists | The database is the last line of defence; permissions are whitelists on two axes (shared data, own data); the service role is confined to an enumerated set of handlers. |
| [0002](0002-immutable-snapshots-idempotent-by-hash.md) | Immutable snapshots, idempotent by hash | One ingestion is one hashed snapshot; the change feed is derived; quarantine instead of deletion. |
| [0003](0003-empty-and-degraded-input-guards.md) | Empty and degraded input guards | A missing, empty or collapsed dataset is a failure, defended in layers that each catch it alone. |
| [0004](0004-http-upload-door-and-external-scheduler.md) | HTTP upload door and external scheduler | A second door takes the file itself; machine callers use their own secrets; schedulers deliver, they do not decide. |
| [0005](0005-migration-guards-and-replay.md) | Migration guards and replay | Forward-only migrations that verify themselves, replay on a clean database, and whose guards must be seen failing. |
| [0006](0006-civil-timezone-period-derivation.md) | Civil-time-zone period derivation | A period is the month it was in the operation's zone, derived by one pure function. |
| [0007](0007-privilege-guards-inside-functions.md) | Privilege guards inside functions | Restrict a `SECURITY DEFINER` function by a role check inside it when callers cannot tolerate a revoke. |
| [0008](0008-derive-family-taxonomy-at-read.md) | Taxonomy derived at read | Interpretation lives in data and read-time derivation; the source is never overwritten. |
| [0009](0009-grounded-assistant-persona-contract.md) | Grounded assistant | Closed intents, answers only from what the model was handed, and a persona that is a tested contract. |

## Principles that run through several records

These are not separate decisions; they recur, and each is enforced by something in the repository.

- **Pure core, impure edges.** Parsers, differ, gates, derivations, alert rules, mail rules, the status taxonomy and corpus chunking are pure and unit-tested without a database (`src/services/etl/`, `src/services/derivaciones.ts`, `src/lib/`). Pages and route handlers are thin: gate, validate, delegate, map errors (`src/lib/api/errors.ts`).
- **One truth per business rule.** Each rule has a single home that every channel (page, notification bell, email, document) consumes: `src/lib/estatus.ts`, `src/lib/fechas.ts` (guarded by `src/lib/una-sola-verdad-temporal.test.ts`), `src/lib/avisos.ts`, `src/lib/correo.ts`, one secret-comparison primitive in `src/lib/api/ingest-auth.ts`. A scheduler never re-implements "what to notify": it only delivers what the portal rendered ([ADR 0004](0004-http-upload-door-and-external-scheduler.md)).
- **Fail closed.** A missing `Origin` on a mutating request is a 403 (`src/lib/api/origin.ts`); a role not named in a write whitelist has no permission ([ADR 0001](0001-rls-roles-and-column-allowlists.md)); a failed role read is treated as "not admin" in the middleware (`src/middleware.ts`).
- **Errors are loud and distinguishable.** "Nothing arrived", "arrived and nothing changed" and "failed" must not look alike: explicit status codes ([ADR 0004](0004-http-upload-door-and-external-scheduler.md)), a retry trail returned in the result (`src/lib/supabase/reintento.ts`), attempts recorded when they start (`corpus_sync_intentos` in `supabase/migrations/0030_b11_corpus.sql`), and an explicit negative path in the assistant ([ADR 0009](0009-grounded-assistant-persona-contract.md)).
- **A guard is not credible until it has been seen failing.** See [ADR 0005](0005-migration-guards-and-replay.md) and [`../testing.md`](../testing.md).

## Where the rest is documented

- Layers, stack and deployment shape: [`../architecture.md`](../architecture.md)
- Tables, invariants and RPCs: [`../data-model.md`](../data-model.md)
- Roles, RLS, secrets, origin check: [`../security.md`](../security.md)
- From workbook to snapshot: [`../ingestion.md`](../ingestion.md)
- Tests and QA conventions: [`../testing.md`](../testing.md)
- Failure classes cited in code as `P1` to `P37`: [`../engineering/failure-patterns.md`](../engineering/failure-patterns.md)
- Known limitations and accepted risks: [`../known-limitations.md`](../known-limitations.md)
- How the project was built with AI assistance: [`../ai-assisted-workflow.md`](../ai-assisted-workflow.md)

## Adding a record

Name the file `NNNN-short-title.md` with the next number; keep the four headings; cite repository paths that exist; state what the decision costs, not only what it buys. A decision that is later reversed is not deleted: it is marked superseded and links to its successor.
