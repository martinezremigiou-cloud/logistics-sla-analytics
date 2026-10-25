# Security model

This document describes who can do what in the system, where each rule is enforced, and which secrets exist. It is written for a reviewer. Every statement points at the file that backs it.

The explicit design position is that **the database is the last line of defense**. The application checks permissions to give good error messages and to stop obvious abuse early, but row-level security (RLS), privileges and hardened functions in Postgres are the authority that survives any refactor of the application. The negative RLS tests deliberately bypass the application for that reason (`scripts/rls-negativas.mjs` and `scripts/seguimientos-negativas.mjs`, file headers). The decision is recorded in [decisions/0001-rls-roles-and-column-allowlists.md](decisions/0001-rls-roles-and-column-allowlists.md) and [decisions/0007-privilege-guards-inside-functions.md](decisions/0007-privilege-guards-inside-functions.md).

## 1. Layers, in the order a request meets them

1. **Edge middleware**: refreshes the Supabase session cookie, redirects unauthenticated page navigation to the login page, and applies the optional maintenance gate (`src/middleware.ts`).
2. **Per-route gates**: authentication, same-origin check, and zod validation, in the route handler (`src/lib/api/auth.ts`, `src/lib/api/origin.ts`, `src/schemas/`).
3. **Postgres**: RLS policies, column privileges, hardened SECURITY DEFINER functions and triggers (`supabase/migrations/`).
4. **Secret-gated machine routes**: ingestion and mailing, which are called by automations rather than browsers (`src/lib/api/ingest-auth.ts`).

## 2. Roles

Four roles are stored in `perfiles.rol`. The CHECK started with `kam` and `admin` (`supabase/migrations/0001_schema.sql`), gained `visitante` in `supabase/migrations/0010_b7a_rol_visitante.sql` and `soporte` in `supabase/migrations/0043_rolsoporte_cuarto_rol_de_solo_lectura.sql`. Every new sign-up gets `kam` (`handle_new_user` in `supabase/migrations/0002_rls.sql`); only an admin changes a role afterwards, and no account is ever born as `soporte`.

Permission has **two independent axes**, and confusing them has produced wrong descriptions before (the comment on `perfiles.rol` in `0043` says so):

- Axis 1, shared data (catalog, classification, families, brands, users): the rule is `is_admin()`. `kam`, `soporte` and `visitante` only read.
- Axis 2, own data (projects, project lines, follows, notification preferences): the rule is "is it yours", not the role.

| Role | Axis 1: shared data | Axis 2: own data | Notes |
|---|---|---|---|
| `admin` | Read and write | Writes own. Can read every project, and can reassign an orphan project, but cannot edit or delete another person's project | Sees the pending-data inbox and the technical classification vocabulary (`src/lib/roles.ts`) |
| `kam` | Read | Read and write own | The default role |
| `soporte` | Read | Read and write own | Twin of `kam` in both axes; not a read-only role |
| `visitante` | Read | Cannot create projects (RLS) and cannot edit them through the API (route gate); RLS alone would not stop a demoted account from editing projects it already owns. Follows and preferences carry no role check at all, so a visitor can keep those | Can use the assistant, because the visitor already reads the full SKU detail and the usage cap applies equally (`src/app/api/chat/route.ts` header) |

The code mirrors the SQL decision. `src/lib/roles.ts` holds `Record<Rol, boolean>` capability maps (`PUEDE_ESCRIBIR_PROYECTOS`, `MUESTRA_CLASIFICACION_V2`, `MUESTRA_PREGUNTAS_POR_RESOLVER`). A `Record<Rol, ...>` does not compile when a role is added without a decision for that map, which is the TypeScript twin of the SQL whitelist below. No permission is granted by comparing a role against the string `'kam'`.

## 3. Gates in the application

| Gate | File | Behavior |
|---|---|---|
| Edge middleware | `src/middleware.ts` | Refreshes the session cookie on each request. Page navigation without a user redirects to `/login?next=`. `/api/**` is not redirected: each route gates itself. With `MANTENIMIENTO=1` everything is rewritten to a maintenance page (a 503 `no_disponible` for API calls) except for admins and `/api/refresh`, `/api/version`. A failed role read is treated as "not admin" (fail closed) |
| Session | `requireSession` in `src/lib/api/auth.ts` | 401 `unauthorized` without a valid user |
| Admin | `requireAdminSession` in `src/lib/api/auth.ts` | Session plus `perfiles.rol === 'admin'`, otherwise 403 `forbidden`. A failure to read the role is a 500, not a 403, so a legitimate admin is not told "forbidden" because of an outage. 13 route files use it |
| Project writer | `requireSessionNoVisitante` in `src/lib/api/auth.ts` | Session plus `PUEDE_ESCRIBIR_PROYECTOS[rol]`. 5 route files use it |
| Same origin | `requireSameOrigin` in `src/lib/api/origin.ts` | First line of every mutating handler except the machine doors, before the body is read. 20 route files call it. The two ingestion doors (`/api/refresh`, `/api/refresh/archivo`) are exempt by contract (`esRutaExenta`) and authenticate with the ingest secret; the two mailing routes do not call it either and authenticate with `x-avisos-secret` (section 4) |
| Machine secret | `ingestaAutorizada`, `secretoDeCabeceraAutorizado` in `src/lib/api/ingest-auth.ts` | Ingestion routes (`x-ingest-secret`) and mailing routes (`x-avisos-secret`) |
| Body size | `bodyTooLarge` in `src/lib/api/body.ts` | Admin write routes cap the declared `content-length` (best effort, by header) |
| Security headers | `next.config.mjs` | See section 8 |

The counts (13, 5, 20) come from counting `route.ts` files under `src/app/api/` that call each gate.

Errors go through one shape and one code-to-status map (`src/lib/api/errors.ts`), with one exception: the JSON ingestion door `src/app/api/refresh/route.ts` builds most of its error bodies by hand (`config_error`, `unauthorized`, `payload_too_large`, `invalid_body`, plus `contract_error` and `etl_failed`, which are not in the common code list), while `src/app/api/refresh/archivo/route.ts` uses the common helpers; see [ingestion.md](ingestion.md), section 6. Either way, unexpected Postgres and PostgREST errors are logged server side and never returned to the client (`src/app/api/refresh/route.ts`, comment above the `etl_failed` response; `internalError` in `src/lib/api/errors.ts` for the rest). The only database text that is forwarded is the curated `RAISE EXCEPTION` message (SQLSTATE `22023` or `P0002`) of `fusionar_familia` and the pending-inbox RPCs, written to be safe to show (`src/services/familias.service.ts`, `src/services/pendientes.service.ts`).

## 4. Origin allowlist (the CSRF layer)

`src/lib/api/origin.ts`:

- It applies only to mutating methods (POST, PUT, PATCH, DELETE). GET and HEAD always pass.
- A missing or non-allowlisted `Origin` on a mutating method is a 403 `forbidden_origin`. This is fail closed on purpose: a proxy that strips the header lands on the safe side. An unparsable request URL also never counts as exempt.
- The allowlist is recomputed on every call (function `allowlist`) from five sources:

  | Source | Included when |
  |---|---|
  | `http://localhost:3000` | `VERCEL` is unset, so never in a real deployment |
  | `http://localhost:$PORT` | `PORT` is numeric |
  | `NEXT_PUBLIC_SITE_URL` | set; must be an absolute URL with protocol |
  | `VERCEL_URL` | set; the current deployment host, `https://` prepended |
  | `VERCEL_PROJECT_PRODUCTION_URL` | set; the stable production alias, same normalization |

- Exemption by contract: `/api/refresh` and its sub-paths. They are called by an automation with no browser, they have their own secret gate, and they sit outside the middleware matcher. The match is anchored by path segment, so a path such as `/api/refresh-token` would not be exempt (`esRutaExenta`, and the matcher in `src/middleware.ts`). The mailing routes do not call `requireSameOrigin` either, for the same reason; their defense is the secret.
- Operational failure mode: if the production origin is absent from the environment, the portal still navigates but every save is refused with "origin not allowed", while ingestion and mail keep working. A build on Vercel (`VERCEL_ENV=production`) prints an error when neither `NEXT_PUBLIC_SITE_URL` nor `VERCEL_PROJECT_PRODUCTION_URL` is set (`next.config.mjs`); a local or CI build prints nothing.
- Tests: `src/lib/api/origin.test.ts`.

## 5. Row-level security and privileges

### 5.1 Baseline

RLS is enabled on all 15 original tables (`supabase/migrations/0002_rls.sql`) and on every table created later. The policy shapes:

| Shape | Applies to | Evidence |
|---|---|---|
| SELECT for `authenticated` (`USING (true)`), no INSERT, UPDATE or DELETE policy, so only `service_role` writes | `snapshots`, `productos`, `stock_por_almacen`, `reservas`, `embarques`, `cambios` | `0002_rls.sql` |
| SELECT for `authenticated`; INSERT and UPDATE `WITH CHECK (public.is_admin())`; no DELETE policy (soft delete) | Catalogs, aliases, overrides, metadata | `0002_rls.sql`, `0004_estatus.sql`, `0008_bparche_clasificacion_v2.sql`, `0018_mvp2_familia_alias.sql` |
| SELECT own-or-admin; UPDATE admin only | `perfiles` | `0002_rls.sql`; the `(SELECT auth.uid())` form that the planner evaluates once is in part P4 of `0012_b7b_hardening.sql` |
| Admin-only SELECT | `pendientes_datos` | `0009_b6_pendientes.sql` |
| Ownership policies on all four verbs | `proyectos`, `proyecto_partidas`, `seguimientos`, `preferencias_notificacion` | `0024_b8_proyectos.sql`, `0026_b9_seguimientos.sql` |
| RLS on, zero policies, privileges revoked from `anon` and `authenticated` | `envios_aviso` (written only by the portal with the service-role client, in the mailing routes) and `consumo_chat` (written only through SECURITY DEFINER RPCs) | `0027_b91_correo.sql`, `0028_b10_chat.sql` |
| Read policy added after a positive control failed | `corpus_documentos`, `corpus_trozos`, `corpus_familia_ficha` | `0032_b11_corpus_lectura.sql` |
| Storage: public read of bucket `producto-imagenes`, admin-only insert, update, delete | `storage.objects` | `0007_b5_storage.sql` |

### 5.2 Hardening patterns, each with its migration

1. **Whitelist, not blacklist, for writes.** The project-insert policy started as `rol <> 'visitante'`, which fails open for the next role someone adds. `0042_rolsoporte_lista_blanca_de_escritura.sql` rewrote it as `rol IN ('kam','admin','soporte')`, which fails closed, and applied it before the migration that adds the new role so there is no window in which the new role inherits a permission. The migration's own guard proves the allowed set is identical row by row. `0043_rolsoporte_cuarto_rol_de_solo_lectura.sql` then widens the role CHECK.
2. **Authorship columns are unreadable to users.** Column-level `REVOKE SELECT` of the audit column (`updated_by`, `editado_por`) from `authenticated`. In PostgreSQL revoking one column alone does nothing while a table-level grant exists, so the migration revokes the table-level SELECT and grants SELECT on every other column. A guard aborts if the revoke did not take effect or if a column was left unreadable. `0012_b7b_hardening.sql`, part P3, on `clasificacion_v2`, `productos_override` and `productos_metadata`.
3. **The consequence, and the fix.** PostgREST builds writes with `RETURNING *`, which expands to a table-level check and fails with 42501 on such tables. Direct upserts from a user session were therefore replaced by SECURITY DEFINER RPCs (`aplicar_metadata` in `0017_mvp2_metadata_por_rpc.sql`). An operator script, not part of `npm test` or CI, checks that no user session writes directly to such a table: `scripts/guarda-lista-blanca.mjs` scans `src/` for direct writes and, given `DATABASE_URL`, derives the list of tables from the catalog instead of listing them by hand; without a database it reports no verdict (exit 2).
4. **SECURITY DEFINER functions are hardened.** `SET search_path` is pinned, EXECUTE is revoked from `PUBLIC` and `anon`, and a specific grant is added. `ingest_snapshot` and the inbox-sync functions are executable by `service_role` only (`0005_ingest_fn.sql`, `0036_cat_b1_tecnologia_y_producto.sql`). Admin RPCs stay executable by `authenticated` because the application calls them with the user's session, and each one re-checks `is_admin()` inside, so the control sits in the function body, not in the grant (`0006_b5_dominio.sql`, `0008_bparche_clasificacion_v2.sql`, header of `0012_b7b_hardening.sql`). A new function in `public` can start executable by `anon` through a named default ACL, which `REVOKE ... FROM PUBLIC` does not remove, so migrations revoke from `anon` by name and the harnesses check the effect (header of `scripts/chat-negativas.mjs`).
5. **No TRUNCATE for application roles, now or for future tables.** RLS does not cover TRUNCATE. `0020_repro_truncate_guarda_pendientes_creado_en.sql` revokes it from `anon` and `authenticated` and uses `ALTER DEFAULT PRIVILEGES` so the leak does not return with the next table; its guard fails if `service_role` loses TRUNCATE. Later migrations that create tables revoke it themselves (`0024_b8_proyectos.sql`, `0026_b9_seguimientos.sql`).
6. **Immutable data.** Snapshots and `cambios` have no UPDATE or DELETE policy (append-only). The SKU trigger blocks changes for every role (`0001_schema.sql`, `supabase/README.md` section "Security notes on the model").
7. **No dangling states.** Deleting an account sets `proyectos.propietario` to NULL (`ON DELETE SET NULL`). One policy lets only an admin reassign such an orphan to a live account whose role can own projects, and an admin still cannot edit or delete projects that have an owner. The invariant: no row may end in a state nobody can leave from the application. `0024_b8_proyectos.sql`, `0025_b8_rescate_de_huerfanos.sql`.
8. **Concurrency-safe limits.** The assistant's rate cap counts and inserts inside one RPC under one lock, instead of counting in the application and writing later (`0028_b10_chat.sql`, `0029_b10_anotar_uso.sql`, header of `src/app/api/chat/route.ts`).
9. **Migration guards, with positive controls.** Most migrations end with a `DO $$` block that reads the catalog and raises if the intended state was not reached. A guard that proves only the absence of harm can leave a table unusable, so positive controls ("this CAN") accompany the negative ones ("this cannot"); `0032_b11_corpus_lectura.sql` is the example. See [decisions/0005-migration-guards-and-replay.md](decisions/0005-migration-guards-and-replay.md).

### 5.3 Negative tests

- `supabase/tests/rls_negative_tests.sql`: eight tests (N1 to N8), each its own transaction rolled back, with the role switched by `SET LOCAL ROLE`. A KAM cannot insert into overrides (42501), cannot update metadata (0 rows), cannot read another profile, cannot insert families (42501), cannot change another user's role (0 rows) and cannot insert into the change feed (42501). An anonymous user reads 0 rows of `productos`. Nobody can change a SKU (trigger exception).
- HTTP-level harnesses that use real JWTs against a local stack and bypass the application: `scripts/rls-negativas.mjs`, `scripts/rls-negativas-proyectos.mjs`, `scripts/seguimientos-negativas.mjs`, `scripts/correo-negativas.mjs`, `scripts/chat-negativas.mjs`. Their pure assertion helpers are unit-tested (`scripts/rls-negativas.test.ts`), and that file's offline sections run under `npm test` and in CI; its live block ("batería EN VIVO") runs only with the Supabase variables in `.env.local` **and** `RLS_EN_VIVO=1`, never in CI (`vitest.config.ts`, guard in `scripts/rls-negativas.test.ts`).
- A measured fact that shapes every one of them: under RLS, a denied SELECT, UPDATE or DELETE returns `200 []`, not 403; only INSERT and RPC calls are loud. So "denied" is asserted by effect (the row is still there, unchanged), never by status code, and a read test requires the service-role witness to see more than zero rows so an empty table cannot pass (`scripts/rls-negativas.mjs` header).

## 6. The service role is confined

- The service-role client is built by one function, `createSupabaseServerClient()` in `src/lib/supabase/server.ts`, marked `server-only`. Its call-sites are an enumerated, small set of route handlers:
  - `src/app/api/refresh/route.ts` and `src/app/api/refresh/archivo/route.ts` (ingestion)
  - `src/app/api/avisos/envios/route.ts` and `src/app/api/avisos/envios/confirmar/route.ts` (mailing)
  - `src/app/api/campana/route.ts` (reads the last-sent ledger only; the route itself gates on a normal session)
  - `src/app/api/usuarios/route.ts` and `src/app/api/usuarios/[id]/route.ts` (Auth admin API; the client is built only after `requireAdminSession` has passed)
- Everything else, including the assistant, uses the session client (`src/lib/supabase/session.ts`), so RLS applies and a feature can never see more than the user could in the UI. The header of `src/services/chat.service.ts` states this.
- `src/lib/supabase/reintento.ts` wraps `fetch` for both clients and retries only a short whitelist of transient PostgREST messages, chosen by response body and never by status. A bad key is therefore not retried silently while a secret is being rotated.
- Test isolation: `vitest.config.ts` injects fake Supabase credentials into `test.env`, and the ratchet `src/lib/supabase/suite-sandbox.test.ts` checks that a child process cannot escape that sandbox with real credentials.

## 7. Machine secrets

### Ingestion secret

`INGEST_SECRET`, at least 16 characters (`src/lib/env.ts`, `getServerEnv`), travels in the header `x-ingest-secret`. The comparison hashes both values with SHA-256 and compares the digests with `timingSafeEqual`, so the secret's length is not observable and a missing header never matches (`src/lib/api/ingest-auth.ts`).

It is documented as a high-privilege credential: whoever holds it can overwrite the whole catalog and feed bytes to the spreadsheet parser, which carries known unpatched advisories (see [known-limitations.md](known-limitations.md)). The acceptance of that risk rests on both capabilities staying with the same principal (comment above `INGEST_SECRET` in `src/lib/env.ts`).

Collapsed workbooks can be forced through only with three headers (`x-forzar-universo-reducido: si`, `x-forzar-motivo` of 12 to 300 characters, `x-forzar-por` of 3 to 120 characters). The recorded identity is self-declared, not authenticated, and the column comment says so (`src/lib/api/forzar-universo.ts`, `supabase/migrations/0022_repro_registro_de_forzado.sql`).

### Mailing secret

`AVISOS_SECRET`, at least 16 characters, header `x-avisos-secret`, same comparison primitive. The mailing endpoint is a read-everything endpoint: it returns every user's alerts. For that reason it accepts the header only, with no session fallback (otherwise any logged-in user could read everyone's alerts), no origin gate, and as little surface as possible. A missing server secret yields 500 `config_error` and a wrong header 401, so the operator can tell whose fault it is. Evidence: header and gate in `src/app/api/avisos/envios/route.ts`, `src/app/api/avisos/envios/confirmar/route.ts`, `getAvisosSecret` in `src/lib/env.ts`; test harness `scripts/correo-negativas.mjs`.

The example workflow keeps no key inside: its HTTP nodes authenticate through a generic header-auth credential that is configured inside n8n and not stored in the file (`n8n/boletin-semanal.json`), and `n8n/workflows.test.ts` fails the build if an exported workflow carries a secret-shaped string (the test says plainly that it recognizes shape only).

## 8. Headers and transport

`next.config.mjs` sets, for every path, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff` and `Referrer-Policy: strict-origin-when-cross-origin`, and turns `poweredByHeader` off. A Content-Security-Policy is a declared gap with reasons recorded in the config comment (listed in [known-limitations.md](known-limitations.md)).

Uploads: images are accepted only into the `producto-imagenes` bucket, which is admin-write, limited to 2 MiB and to png, jpeg and webp (`supabase/migrations/0007_b5_storage.sql`). The allowed image host is pinned in `images.remotePatterns` in `next.config.mjs`.

Ingestion inputs are hostile by assumption. `src/services/ingesta/io.ts` requires the ZIP signature before handing bytes to the parser, because the parser would otherwise silently reinterpret arbitrary bytes as a text sheet, and refuses workbooks that declare more than 2,000,000 cells (`MAX_CELDAS_LIBRO`), because the sheet's declared dimension, controlled by the sender, otherwise decides how much memory the parser allocates. Details in [ingestion.md](ingestion.md); tests in `src/services/ingesta/__tests__/io.buffer.test.ts`.

## 9. The assistant and the corpus

- The model never writes SQL and never touches the database. On the routed path it only classifies the question into a catalog of intents, and any output outside the catalog becomes `no_soportado`; the factual answer comes from already-tested services under the user's session (`src/lib/chat/enrutador.ts`, `src/services/chat.service.ts`). On the document path the model rewrites the retrieved corpus sections into short quoted sentences, and a guard rejects the whole answer if any datum is not inside its own quotation (`src/lib/chat/redactor.ts`, `src/lib/chat/verificar-redaccion.ts`).
- What reaches the provider: the classifier receives the question text only. The rewriter also receives the short thread of previous turns and the sections of one corpus document from an allow-listed folder, capped in bytes, which can only be built through `armarEntrega` (`src/lib/chat/proveedor.ts`, `src/lib/chat/entrega.ts`).
- The usage cap is charged before the model is called, so a blocked loop does not keep spending (`src/app/api/chat/route.ts` header).
- The usage ledger stores no question text, because the text can carry personal data (`supabase/migrations/0028_b10_chat.sql`, comments).
- The corpus indexer stops the whole batch if any file looks like a secret, instead of skipping that file, and stops on a mass deletion (`src/lib/corpus/secretos.ts`, `src/lib/corpus/manifiesto.ts`, `src/services/corpus.service.ts`).
- Contract: [decisions/0009-grounded-assistant-persona-contract.md](decisions/0009-grounded-assistant-persona-contract.md).

## 10. Secrets and environment variables

Variable names only; no value belongs in the repository. `.gitignore` ignores `.env*` except `.env.example`, which holds placeholders, and CI copies that template (`.github/workflows/ci.yml`). Real values live in the host's environment settings.

| Variable | Scope | Purpose | Read in |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public (shipped to the browser) | Supabase client and middleware | `src/lib/env.ts` |
| `SUPABASE_SERVICE_ROLE_KEY` | Server only, high privilege | Service-role client | `src/lib/env.ts`, `src/lib/supabase/server.ts` |
| `INGEST_SECRET` | Server only, high privilege, 16 characters minimum | Ingestion header secret | `src/lib/env.ts` (`getServerEnv`) |
| `AVISOS_SECRET` | Server only, high privilege, 16 characters minimum | Mailing endpoint secret; validated at the point of use so a missing value breaks only that route | `src/lib/env.ts` (`getAvisosSecret`) |
| `OPENAI_API_KEY`, `DEEPSEEK_API_KEY`, `CHAT_PROVEEDOR`, `OPENAI_MODELO`, `DEEPSEEK_MODELO` | Server only; the keys are high privilege because they spend money | Assistant provider selection: an explicit `CHAT_PROVEEDOR` wins, otherwise the DeepSeek key when present, otherwise OpenAI; a missing key breaks only the assistant | `src/lib/env.ts` (`getProveedorChat`) |
| `OPENAI_MODELO_EMBEDDING` | Server | Embedding model for the corpus indexer; `OPENAI_API_KEY` is also read by the corpus sync script | `src/lib/corpus/embebedor-openai.ts`, `scripts/corpus-sync.mjs` |
| `NEXT_PUBLIC_SITE_URL` | Public configuration, not a secret | Origin allowlist | `src/lib/api/origin.ts`, `next.config.mjs` |
| `MANTENIMIENTO` | Server | Maintenance switch (`1` enables it) | `src/middleware.ts` |
| `VERCEL`, `VERCEL_URL`, `VERCEL_PROJECT_PRODUCTION_URL`, `VERCEL_ENV`, `VERCEL_DEPLOYMENT_ID`, `VERCEL_SKEW_PROTECTION_ENABLED`, `PORT`, `NODE_ENV` | Platform-provided | Origin allowlist, deployment id, version probe, environment label on project documents | `src/lib/api/origin.ts`, `next.config.mjs`, `src/app/api/version/route.ts` (`VERCEL_DEPLOYMENT_ID`), `src/app/api/proyectos/[id]/documento/route.ts` (`VERCEL_ENV`, `NODE_ENV`) |
| `NEXT_PUBLIC_DEPLOY_ID` | Derived at build | Set from `VERCEL_DEPLOYMENT_ID` so the client can detect a new deployment | Set in `next.config.mjs`; read in `src/components/shared/aviso-version-nueva.tsx` and `src/components/config/config-acerca.tsx` |
| `SUPABASE_DB_URL`, `DATABASE_URL` | Local tooling only | Connection string for the migration applier and the static guard | `scripts/aplicar-migracion.mjs`, `scripts/guarda-lista-blanca.mjs` |
| `PARCHE_ADMIN_EMAIL`, `PARCHE_ADMIN_PASSWORD` | Tooling only, read from the process environment and never from `.env.local`; the password is a credential | An existing administrator account that `npm run layout-check` signs in with (it never creates accounts) | `scripts/layout-check.mjs` |
| `LAYOUT_CHECK`, `LAYOUT_CHECK_PORT`, `EVIDENCIA_VISUAL`, `ETL_EVIDENCE`, `NEXT_DIST_DIR`, `RLS_EN_VIVO` | Test and tooling only | Layout instrument, evidence tooling and the opt-in live block of the RLS test (`RLS_EN_VIVO=1`) | `scripts/layout-check.mjs`, `scripts/rls-negativas.test.ts`, tests |

Rules the code applies to secrets:

- Server secrets are validated with zod and a minimum length. The two secrets that gate optional routes (`AVISOS_SECRET`, the chat key) are deliberately not in the shared server schema: adding a new mandatory variable there would take down ingestion and user administration in any deployment that has not set it yet (comments in `src/lib/env.ts`).
- Provider keys are checked only for "looks like a secret" (a loose length floor), not for a provider-specific format, because formats change and a format check protects nothing (`src/lib/env.ts`).
- Public variables (`NEXT_PUBLIC_*`) are configuration. The anonymous key is safe to ship only because RLS is the real protection.
- A secret in the repository is a defect. `.gitignore` ignores `.env*` except the placeholder-only `.env.example`, and two checks detect a secret-shaped string: the corpus indexer and the workflow export test (`src/lib/corpus/secretos.ts`, `n8n/workflows.test.ts`). The comparison of the ingestion secret (`src/lib/api/ingest-auth.ts`) belongs to section 7.
