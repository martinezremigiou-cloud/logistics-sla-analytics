# Supabase — migrations, RLS and negative tests

This folder contains the complete database schema (Postgres + Supabase): the
numbered migrations, their guards and the negative RLS tests. The explanation of
why it is designed this way lives in `docs/data-model.md`, `docs/security.md`
and `docs/decisions/`.

## What is here

| Path | What it is |
|---|---|
| `migrations/` | The migrations, in strict numeric order. Each one carries a header comment saying what it does; from `0020` on each also carries an irreversibility checklist, and most of them end with a guard that **measures** the result instead of assuming it. `0002`, `0003`, `0004`, `0005` and `0007` have no guard at all. |
| `tests/rls_negative_tests.sql` | Eight negative RLS tests (N1–N8), each in its own transaction with `ROLLBACK`. |

The numbering has gaps on purpose (0016 and 0021 do not exist): a migration
withdrawn before being applied is not renumbered. The applier compares the
database ledger against the disk and rejects any mismatch (see below).

## Application order

Migrations are applied in **strict order** (0001 → 0044). The first three
establish the schema:

| # | File | Contents |
|---|---|---|
| 1 | `0001_schema.sql` | pgcrypto extension; root catalogs (almacenes, familias, marcas, kams, estatus_catalogo, perfiles); snapshots; tables with FKs (productos, stock_por_almacen, reservas, embarques, productos_metadata, productos_override, marca_alias, cambios); indexes; function `protect_sku_immutable` + trigger; business invariants |
| 2 | `0002_rls.sql` | Function `is_admin()`; `handle_new_user()` + trigger `on_auth_user_created`; RLS enabled on the tables; all access policies |
| 3 | `0003_seeds.sql` | Idempotent seed of the base catalogs (almacenes, estatus, sample KAM and marcas) |

The rest extend the model (classification, pending items, projects, follow-ups,
mail, chat, corpus) and tighten privileges; each header says what it depends on.

## How to apply them locally

With the Supabase CLI and Docker:

```bash
supabase start        # starts local Postgres/Auth/Storage
supabase db reset     # applies all migrations on a clean database
```

With a Postgres connection string (`DATABASE_URL` or `SUPABASE_DB_URL`, see
`.env.example`), use the repo's applier, which validates before writing:

```bash
# 1. static analysis of the migration (RAISE balance, $...$ bodies)
node scripts/verificar-migracion.mjs supabase/migrations/<archivo>.sql

# 2. application with ledger, irreversibility checklist and guards
node --env-file=.env.local scripts/aplicar-migracion.mjs \
  supabase/migrations/<archivo>.sql --irreversibilidad="<respuesta al checklist>"
```

`scripts/aplicar-migracion.mjs` requires the irreversibility checklist and
compares the ledger (`supabase_migrations.schema_migrations`) against the files
on disk; the disk is canonical. `scripts/compilar-migracion.mjs` compiles a
migration against Postgres WITHOUT applying it (it replaces the final `COMMIT`
with `ROLLBACK`).

> These scripts write to whichever database the connection string points at.
> Use them only against a local or disposable database.

## Post-apply verification

After applying the migrations, check that the expected tables exist:

```sql
SELECT tablename
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename;
```

The core tables (from 0001) are: `almacenes`, `cambios`, `embarques`,
`estatus_catalogo`, `familias`, `kams`, `marca_alias`, `marcas`, `perfiles`,
`productos`, `productos_metadata`, `productos_override`, `reservas`, `snapshots`
and `stock_por_almacen`. Later migrations add more.

With a live database you can also run Supabase's security analysis
(`supabase db lint` or the advisors panel) to confirm that no active warnings
remain.

## TypeScript types

The hand-written types are the typed source of truth for the code:

| File | Exported type | Notes |
|---|---|---|
| `src/types/cambio.ts` | `Cambio` | 1:1 with the `cambios` table; `sku` nullable (BAJAs) |
| `src/types/snapshot.ts` | `Snapshot` | includes file and rows (nullable) |
| `src/types/perfil.ts` | `Perfil` | — |
| `src/types/embarque.ts` | `Embarque` | — |

All of them are re-exported from `src/types/index.ts`.

## First administrator

The first user to sign up automatically receives `rol = 'kam'` (trigger
`on_auth_user_created`). To promote the first administrator, run the following on
a **local** database with the service key:

```sql
UPDATE public.perfiles
SET rol = 'admin'
WHERE email = 'admin@example.com';
```

(or use `scripts/bootstrap-admin.mjs`, which creates the founding account and
assigns it the role; it reads `NEXT_PUBLIC_SUPABASE_URL` and
`SUPABASE_SERVICE_ROLE_KEY` from the environment and is **not run in CI**). From
then on, an admin manages everyone else's roles from the application.

## Negative RLS tests

There are two batteries, with different scope:

1. `supabase/tests/rls_negative_tests.sql`: 8 tests (N1–N8) that verify that the
   core policies block unauthorized operations. Run them one by one in the SQL
   Editor or with `psql`; each block ends in `ROLLBACK`.

   | Test | Scenario | Expected result |
   |---|---|---|
   | N1 | KAM INSERT into productos_override | ERROR 42501 |
   | N2 | KAM UPDATE on productos_metadata | 0 rows updated |
   | N3 | KAM SELECT of another user's profile | 0 rows |
   | N4 | KAM INSERT into familias | ERROR 42501 |
   | N5 | Anonymous SELECT on productos | 0 rows |
   | N6 | Nobody changes the SKU (trigger) | EXCEPTION SKU inmutable |
   | N7 | KAM UPDATE of another user's role | 0 rows updated |
   | N8 | KAM INSERT into cambios | ERROR 42501 |

2. `scripts/rls-negativas.mjs` (and the variants `rls-negativas-proyectos.mjs`,
   `seguimientos-negativas.mjs`, `chat-negativas.mjs`, `correo-negativas.mjs`):
   **live** batteries against PostgREST with real ephemeral sessions. They cover
   the tables created after the core. They need a live database, so they are
   outside `npm test` and CI. The file `scripts/rls-negativas.test.ts` does run
   under `npm test` and in CI (`vitest.config.ts`): its offline sections (the
   declared matrix, the pure evaluator and the latency probe) always run, while
   its live block ("batería EN VIVO") runs only when the Supabase variables are
   present in `.env.local` **and** `RLS_EN_VIVO=1` is set (guard in that file).
   They create and destroy their own accounts and **must not be run in
   parallel** with one another.

## Security notes on the model

- **Immutable snapshots:** there is no UPDATE or DELETE policy on `snapshots`.
  Only `service_role` can insert. An authenticated KAM or admin can only read.
- **`cambios` is append-only:** there is no UPDATE or DELETE policy. Only
  `service_role` inserts.
- **Immutable SKU:** the `before_update_sku` trigger raises an EXCEPTION if
  anyone tries to modify the `sku` field of any product, even with
  `service_role`.
- **`is_admin()`, `handle_new_user()` and `protect_sku_immutable()` are
  SECURITY DEFINER** with a fixed `SET search_path`, so that a manipulated
  `search_path` cannot evade integrity or permissions.
- **No FK to `auth.users` in the initial schema:** this avoids depending on the
  internal schema of Supabase Auth (a later migration adds the `perfiles` FK).
- **ETL writes via `service_role`:** the ingestion endpoints use the service key
  (never exposed to the client) to insert snapshots, products, stock,
  reservations, shipments and changes, which avoids write policies for those
  tables.
- **`sku` without an FK in `cambios`:** intentional: it allows recording SKU
  BAJAs for products that no longer exist in `productos`.

## Operational notes

- Migrations are idempotent where applicable (`IF NOT EXISTS`,
  `ON CONFLICT DO NOTHING`, `DROP POLICY IF EXISTS`). Re-applying an individual
  migration does not break the schema.
- Migration 2 creates a trigger on `auth.users`: it requires the `auth` schema
  to exist (guaranteed in every Supabase project).
- The seed (migration 3) depends on the tables of migration 1. Never apply out
  of order.
- **Do not edit already-applied migrations or their line numbers:** the tests in
  `scripts/verificar-migracion.test.ts` and `scripts/aplicar-migracion.test.ts`
  pin file names, `RAISE` counts and line positions of several migrations.
