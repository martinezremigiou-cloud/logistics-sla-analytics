# Known limitations

An honest list of what this system does not do, does only partly, or does by decision. It also keeps the IDs that the source code cites in comments and test titles, so that a token such as `B10-3` or `ING-1` found in a file can be looked up here.

How to read an entry:

- **Status** is one of *open*, *closed* (fixed; kept because the code still cites the ID), *accepted* (a risk taken knowingly, with its mitigation) or *mitigated*.
- Each entry gives what the limitation is, why it exists or what it costs, and the file that proves it. Where a trigger is known (the event that should reopen the decision), it is stated.
- Entries describe mechanisms, not production measurements; this repository ships synthetic data only.
- Some tokens in test titles that look like registry IDs are **block-local step numbers** of the assistant work (for example the `[CHAT-B3] B3-1` describe block in `src/app/api/chat/route.test.ts` and the `[CHAT-B4] B4-2` one in `src/services/chat.service.test.ts`). They are not entries of this page. Where an ID is both (`B3-5`), the entry below is the registry one.
- Related reading: the failure classes behind many of these entries are in `docs/engineering/failure-patterns.md` (`P<n>`), the security model is in `docs/security.md`, and the decisions that created some of them are in `docs/decisions/README.md`.

## Index

| Area | IDs |
|---|---|
| Accepted risks | ING-1, B1-2, B1-6, B7A-10, B7B-6, B10-1, B8-2, B11-2 |
| Security and access | B0-1, B0-2, B1-7, TAXO-10, B7A-9, MVP2-5, MVP2-6, B4-5, B5-12, B7B-1, B7B-2, B2-5, B3-6, B5-14, A1-14, B5-10, B7B-19, B6-5, MVP2-2, B8-11 |
| Data, ingestion and ETL | B3-1, B3-5, B3-4, B7A-1, BP-9, ING-6, ING-9, ING-10, B2-4, B6-7, A1-9, EL-TRINQUETE-NO-VE-LECTURAS-SIN-TOPE, B10-3, B10-4, B9-1, B8-10, B82-1, B91-2, MVP2-1, B8-1, MARCA-NUEVA-ENTRA-EN-SILENCIO, VERTICAL-FUERA-POR-EL-DATO, A1-1, A1-2, PROYECTO-ACTIVO-NO-EXISTE, RUTA-EMBARQUES-CAMBIA-DE-SIGNIFICADO, DOS-CONTEOS-GLOBALES-SIN-SUPERFICIE, DOS-FILTROS-VIVOS-SIN-PUERTA, EL-PULSO-AGREGA-POR-SKU-Y-MEZCLA-EMBARQUES, RESERVAS-CONCENTRACION-VS-DISPERSION, B7B-10, TAXO-6 |
| Roles and migrations | DISPARADOR-DE-DESESTACIONAR-UN-ROL-NO-ESTA-MECANIZADO |
| Documents, interface and tests | WORKER-DESINCRONIZADO, NODE-SIN-FIJAR-Y-PDFJS-EXIGE-22, SUITE-DE-PRESENTACION-DEPENDE-DE-LA-RED, PREVIA-Y-DESCARGA-NO-COMPARTEN-BYTES, ROTULO-VIGENTE-EN-CUATRO-SITIOS-Y-SOLO-TRES-SE-ALINEARON, ROTULO-OCUPADO-NO-CONCUERDA-CON-SU-NOMBRE, PAR-SIN-ETIQUETA-SE-LEE-COMO-PARTE-SOBRE-TODO, SOBRE-RESERVADO-SIN-COPY, GATE-DE-CARGA-LEE-PROSA, ESQUELETO-Y-VISTA-NO-SE-COMPARAN, PALETA-DE-PROYECTO-NO-GIRA-CON-EL-TEMA, PARSER-DE-GLOBALS-LEE-COMENTARIOS, STRIPPER-DE-FUENTE-SE-COME-DESDE-UN-BLOQUE-FALSO, NAV-MOVIL-TRAGA-EN-SILENCIO, RIEL-DETALLE-SIN-GUARDA-VISUAL, B81-2, FR-1, B5-3, B11-1, A1-12, A1-13, A1-15, GATE-DE-CONTROL-LAYOUT-SIN-PRUEBA, B8-8, GUARDA-DE-LISTA-CARA-SIN-CAUSA-MEDIDA, B8-9 |
| Assistant | B10-5, B10-6, B10-7, B10-9, B11-3, HILO-SIN-CALIBRAR, UNA-LISTA-FIJA-SOBRE-UN-CORPUS-QUE-CRECE-ENVEJECE-SOLA |
| Newsletter workflow | B91-4, B91-5, B91-6, REMITENTE-SIN-ALINEAMIENTO-DMARC, RETRYONFAIL-DEL-ENVIO-REENVIA-A-TODOS, PRECONDICIONES-PARA-ACTIVAR-EL-BOLETIN |

## Accepted risks

These are risks taken with open eyes. Each has the reason and the mitigation that is actually in the tree.

### ING-1 · Spreadsheet parser with known CVEs

**Status: accepted.** `package.json` pins `xlsx` at `0.18.5`, installed from the public npm registry. That version has two published advisories (prototype pollution, CVE-2023-30533; regular-expression denial of service, CVE-2024-22363) fixed only in later releases that are not published on the registry. The original mitigation ("only an internal CLI feeds the parser") disappeared once an HTTP upload door existed: `src/app/api/refresh/archivo/route.ts` parses bytes that arrive over HTTP.
**Barriers in the tree** (none of them patches the CVEs): a shared ingest secret compared in constant time over a hash (`src/lib/api/ingest-auth.ts`); a 15 MB cap checked twice, on the declared length and on the bytes actually read (`MAX_ARCHIVO_BYTES` in `src/app/api/refresh/archivo/route.ts`, the same cap for the JSON door in `src/app/api/refresh/route.ts`); the ZIP signature guard and a declared-cell budget evaluated before allocation (`esZip`, `presupuestoDeCeldas` in `src/services/ingesta/io.ts`).
**Why accepted.** Only a holder of `INGEST_SECRET` can reach the parser, and that principal can already overwrite the whole inventory, so the incremental privilege is nil; moving to a tarball outside the registry would worsen the supply chain for a tool with one caller. **Binding condition:** `INGEST_SECRET` is a high-privilege credential with the same rotation and storage discipline as the service key (`src/lib/env.ts`), and the decision is re-opened before anything else is allowed to call the ingest. See `docs/decisions/0004-http-upload-door-and-external-scheduler.md`. This repository makes no claim of a clean `npm audit`.

### B1-2 · No FORCE ROW LEVEL SECURITY

**Status: accepted.** No migration uses `FORCE ROW LEVEL SECURITY`, so the table owner and the service role bypass RLS (expected on the managed platform). The risk is a later migration that grants table privileges to another role. The service key is read only by server code (`src/lib/supabase/server.ts`). See `docs/security.md` and `docs/decisions/0001-rls-roles-and-column-allowlists.md`.

### B1-6 · An admin can edit any profile field, including the role

**Status: accepted.** The policy `perfiles_admin_update` in `supabase/migrations/0002_rls.sql` has no column restriction, so an admin can perpetuate themselves or demote another admin. That is the intended behaviour of "admins manage roles" for a small user base. Possible fix: a field-level restriction or a super-admin.

### B7A-10 · Public image bucket allows enumeration

**Status: accepted.** The product-image bucket is public and its path is derivable from the SKU, so anyone with the project URL can fetch or list pictures without a session (`supabase/migrations/0007_b5_storage.sql`). Low-sensitivity asset; reconsider if the images stop being public catalogue pictures. Writes stay blocked for every non-admin role (`anon`, `kam` and `visitante` are the roles tested in `scripts/rls-negativas.test.ts`); only an admin can write (the `producto_imagenes_admin_*` policies in `0007`).

### B7B-6 · Session cookie is not `httpOnly`

**Status: accepted.** The cookie comes from `@supabase/ssr`, which must expose the token to the browser (`src/middleware.ts`, `src/lib/supabase/session.ts`). Any script injected into the portal can read the session. No code-level mitigation exists without changing the auth library; a strict `script-src` policy would lower the risk a lot (see B7B-1).

### B10-1 · The assistant's intent classification is not deterministic

**Status: accepted.** The chosen model rejects `temperature: 0`, and `seed` was not verified for it, so neither is sent (`src/lib/chat/modelo-openai.ts`, `src/lib/chat/proveedor.ts`). The *answer* is deterministic because the server renders the card from derived data; the variability lives in one step, which of the intents was chosen. The evaluation keeps per-case lists and reports the unstable questions separately (`src/lib/chat/evaluacion.ts`).

### B8-2 · The generated PDF uses the standard PDF fonts

**Status: accepted.** `src/services/documento/pdf.ts` draws with the 14 standard fonts of the format (Helvetica, Courier), not the portal typeface. In exchange the repository carries no font binary and no font licence file. It is closed in one commit if brand fidelity ever outweighs repository weight.

### B11-2 · A very long SKU still truncates in the selection rail

**Status: accepted.** The two-line row of the rail cannot fit the longest catalogue codes; truncation does not hide the data because the `title` attribute carries the full value (`src/components/seleccion/panel-seleccion.tsx`). The layout check reports truncated boxes above a threshold instead of denouncing them (`src/lib/layout-check/predicados.ts`).

## Security and access

### B0-1 · Server client could fall back silently to the public key

**Status: closed.** The privileged client now reads its key through a validated schema that throws when the key is missing (`getServerEnv` in `src/lib/env.ts`, used by `src/lib/supabase/server.ts`), so the ETL cannot run with anonymous privileges without noticing.

### B0-2 · Public and server environment schemas share one module

**Status: open, minor.** `src/lib/env.ts` holds both the public schema and `getServerEnv`; nothing leaks because the server function is only called from server code, but the separation is weaker than a dedicated server-only module.

### B1-7 · Authorship columns are free text

**Status: partly closed.** `productos_override.editado_por` and `productos_metadata.updated_by` are `text`, not forced to `auth.uid()`. The override RPC sets the author server-side (`supabase/migrations/0006_b5_dominio.sql`, `src/services/override.service.ts`), so integrity depends on that path being the only writer.

### TAXO-10 · Authorship columns readable by any authenticated user

**Status: closed.** `clasificacion_v2.updated_by` and `productos_override.editado_por` were readable by every signed-in role through `USING (true)` policies (`supabase/migrations/0002_rls.sql`, `supabase/migrations/0008_bparche_clasificacion_v2.sql`). Closed by column-level grants in `supabase/migrations/0012_b7b_hardening.sql`. The consequences are MVP2-5 and MVP2-6 below; the ADR is `docs/decisions/0001-rls-roles-and-column-allowlists.md`.

### B7A-9 · Aggregate-count function had no role guard

**Status: closed (`0020`).** `contar_pendientes()` was `SECURITY DEFINER` with no role check and executable by `authenticated`, while the table policy is admin-only, so any signed-in user got the counts by type. Its current body (`supabase/migrations/0020_repro_truncate_guarda_pendientes_creado_en.sql`) checks `is_admin()` inside and returns the neutral shape (`abiertos` 0, empty `por_tipo`) to everyone else. `EXECUTE` stays granted to `authenticated` on purpose, because the dashboard calls it under the user's session and an error there would be a 500; the negative RLS tests pin that grant, not the body (`scripts/rls-negativas.mjs`, `scripts/rls-negativas.test.ts`). Original definition: `supabase/migrations/0009_b6_pendientes.sql`; the pattern of guarding inside the function is in `docs/decisions/0007-privilege-guards-inside-functions.md` (P18).

### MVP2-5 · The allowlist tables are born denied

**Status: open by design.** Three tables have no table-level `SELECT` for `authenticated`, only column-by-column grants, so any column added later is invisible until it is granted (fail-closed). PostgREST builds writes with `RETURNING *`, so direct writes on those tables fail with 42501; writes go through RPCs. `scripts/guarda-lista-blanca.mjs` derives the table list from the catalog and fails if a session writes directly.

### MVP2-6 · `anon` keeps table-level SELECT on the allowlist tables

**Status: open, not exploitable today.** The `REVOKE` in `0012` was for `authenticated` only; RLS hides the rows because every policy on those tables is `TO authenticated`. If someone adds a public read policy, the identity leak returns by that door. Review this before touching those tables' RLS (`supabase/migrations/0012_b7b_hardening.sql`). Not to be confused with the default `TRUNCATE` privilege, which the applied migration `supabase/migrations/0018_mvp2_familia_alias.sql` also cites as `MVP2-6`: that matter is closed by `0020` (`docs/security.md`, item 5), and an applied migration is frozen, so its comment is not edited.

### B4-5 · Product image from a database URL without an origin allowlist

**Status: closed.** Product images render through `next/image` with `remotePatterns` (`next.config.mjs`, `src/components/ficha/ficha-imagen.tsx`).

### B5-12 · CSRF defence was implicit

**Status: closed (superseded).** The first defence was `SameSite=Lax` plus a JSON content type. Mutating routes now check `Origin` against an allowlist and fail closed (`src/lib/api/origin.ts`); the ingest routes are exempt by contract, and so are the two mail routes (`src/app/api/avisos/envios/`), because they authenticate with a secret and are called without a browser.

### B7B-1 · No Content-Security-Policy

**Status: open.** `next.config.mjs` and `src/middleware.ts` set no CSP, not even report-only: the real script, style, image and connect sources have not been inventoried, and a report-only policy without a collecting endpoint tells nobody anything. It compounds B7B-6. Trigger: before exposing the portal beyond a small internal audience.

### B7B-2 · Body-size caps by `content-length` are best-effort

**Status: open.** `bodyTooLarge` (`src/lib/api/body.ts`) trusts the header; a chunked request evades it and the body is fully read before it is rejected. The same mechanism applies to B2-5 (`src/app/api/refresh/route.ts`), B3-6 (`src/lib/api/body.ts`) and B5-14 (`src/app/api/imagenes/route.ts`). A hard streaming limit is the fix if the portal stops being a small signed-in audience.

### B2-5 · Ingest JSON route size cap is header-based

**Status: open, info.** Same mechanism as B7B-2, in `src/app/api/refresh/route.ts`; the file-upload door adds a second check on the bytes actually read (see ING-1).

### B3-6 · Generic write-body cap is header-based

**Status: open, info.** `MAX_BODY_BYTES_ESCRITURA` in `src/lib/api/body.ts`; same mechanism as B7B-2.

### B5-14 · Image upload parses the body before the exact size check

**Status: partly mitigated.** `src/app/api/imagenes/route.ts` cuts on the declared length before calling `req.formData()`, but when the length is absent (chunked) the whole multipart body is materialized before `validarImagen` applies the byte-exact limit (`MAX_IMAGEN_BYTES`, `src/lib/imagenes.ts`). Same mechanism as B7B-2.

### A1-14 · There is no "delete account" operation

**Status: open.** The user API has list, create, change role, suspend, reactivate and reset password, and no delete: `src/app/api/usuarios/route.ts` exports `GET` and `POST`, `src/app/api/usuarios/[id]/route.ts` exports `PATCH`. It was decided from the first RLS migration ("no DELETE"). Deleting is blocked by a check constraint that is incompatible with `ON DELETE SET NULL` on a reviewer column and by undecided product questions (what happens to owned projects). The only path to recover an administrator is `scripts/bootstrap-admin.mjs`.

### B5-10 · The recovery administrator address is a constant

**Status: partly closed.** `scripts/bootstrap-admin.mjs` takes the founder address from a constant that must become configuration. `src/lib/admin-fundador.test.ts` compares it with the contacts directory (`src/lib/contactos.ts`); that compares two copies (P33), so it detects them drifting apart but not both ageing together.

### B7B-19 · A QA agent deleted every account of a project

**Status: closed (fixed in the same block).** A script allowed to delete a few disposable accounts listed them by an email filter that the auth API silently ignored, and deleted the full list (P9). `scripts/rls-negativas.mjs` now creates ephemeral fixtures per run, keeps the returned ids, deletes only those ids, counts users before and after, caps the radius and reports exact UUIDs if cleanup fails. Tested in `scripts/rls-negativas.test.ts`.

### B6-5 · The SQL file of negative RLS tests covers only the first group of tables

**Status: mitigated.** `supabase/tests/rls_negative_tests.sql` covers the tables of the first schema block; the later tables (classification layer, technologies, pending items, storage objects) are covered by the live script `scripts/rls-negativas.mjs`, and `scripts/rls-negativas.test.ts` declares the exact list of tables whose SQL coverage is still pending.

### MVP2-2 · Live harnesses cannot run concurrently

**Status: mitigated (warning in the header).** `scripts/rls-negativas.mjs` counts `auth.users` before and after and aborts if the balance differs; a second harness creating accounts at the same time moves that count and produces a red file with zero failed assertions, which is the signature of a collection failure. Run live harnesses serially.

### B8-11 · Project write policies check ownership, not role

**Status: open.** The `UPDATE` and `DELETE` policies on `proyectos` (`proyectos_update_own` and `proyectos_delete_own` in `supabase/migrations/0024_b8_proyectos.sql`) only require `propietario = auth.uid()`. An account demoted to `visitante` that still owns projects could change or delete them by calling PostgREST directly with its session. Today only the route gate stops that path, and no negative test covers it.

## Data, ingestion and ETL

### B3-1 · Override write was two non-atomic statements

**Status: closed.** Deactivate-then-insert is now one atomic RPC, `aplicar_override` (`supabase/migrations/0006_b5_dominio.sql`), called from `src/services/override.service.ts`; the read side still takes the latest active override defensively.

### B3-5 · Case-insensitive uniqueness of families rested on a sequential pre-check

**Status: closed.** A unique index on `lower(nombre)` (`familias_nombre_lower_uidx` in `supabase/migrations/0006_b5_dominio.sql`) covers all rows, active or not. `src/services/familias.service.ts` and `src/services/override.service.ts` still mention the old risk in comments.

### B3-4 · Catalog filtering and derivation run in memory over the current snapshot

**Status: accepted, bounded.** The catalog and dashboard services load the current snapshot and derive in memory (`src/services/inventory.service.ts`, `src/services/dashboard.service.ts`); this is deliberate for a small audience. Trigger: reconsider SQL pushdown and a pre-indexed override map if the catalogue grows well beyond its documented bound.

### B7A-1 · The shipments ledger paginates in memory

**Status: accepted, bounded.** Filtering, ordering and paging happen in memory over the whole current customs snapshot, with a design bound written in the header of `src/services/embarques.service.ts`. Trigger: a snapshot beyond that bound moves the `ambito`, `estatus` and `is_historial` filters (`src/schemas/embarques.schema.ts`, `src/services/embarques.service.ts`) to SQL with an exact count.

### BP-9 · Reservations with no date rotate their date once a month

**Status: open, low.** A reservation without a date in the source is stamped with the first day of the period (`src/services/etl/parse.reserva.ts`, filled in `src/services/etl/runEtl.ts`) so it does not change on every run. The cost is residual, deterministic noise in the monthly diff, pinned in `src/services/etl/__tests__/computeSnapshot.test.ts`. Root fix: owners fill the dates in the workbook, or the column becomes nullable.

### ING-6 · Reservations with an unknown KAM keep `kam_id = null`

**Status: open, data.** KAM means key account manager. The ETL does not guess: such rows stay unattributed and are queued for a human (`kam_desconocido` in `supabase/migrations/0009_b6_pendientes.sql`, produced from `src/services/etl/persist.ts`). Once the person exists in `kams`, the next monthly run attributes their reservations by itself.

### ING-9 · Previous-state reads used `.data ?? []` without checking `.error`

**Status: closed.** The previous-state SELECTs now fail fast through `assertPrevOk` (`src/services/etl/persist.ts`, tests `src/services/etl/__tests__/persist.loadPrevState.test.ts`), with the legitimate "no previous snapshot" case preserved. The same class of bug is noted in `src/services/proyectos.service.ts` (P4).

### ING-10 · A stock workbook sent as `source=aduana` is not rejected on the first load

**Status: open, low.** `source` is never guessed from the file, and the shipments side is a catch-all: any sheet that is not excluded or pending is read as a shipments sheet (`src/config/ingesta-mapeo.ts`), so a stock workbook sent as `source=aduana` parses as sheets that hold no shipment rows. The opposite mistake is refused: a shipments workbook sent as `source=stock` fails with `DatasetsStockFaltantesError`, a 400 (`src/app/api/refresh/archivo/route.ts`). The only net under the first mistake is the universe-shrink guard in `computeSnapshot` (`src/services/etl/runEtl.ts`), and it does not apply when there is no previous snapshot to compare against, so on the first load of that source an empty shipments snapshot is accepted. Once the shipments chain holds a non-empty snapshot, the same mistake is answered with 409 `universo_reducido`. A gate that refuses a shipments body in which no sheet yields a shipment row would close it; it has not been added. See `docs/ingestion.md`, section 4.1.

### B6-7 · The inbox type `cuarentena_etl` has no producer

**Status: open, half closed.** The pending-items inbox accepts the type `cuarentena_etl` (CHECK in `supabase/migrations/0009_b6_pendientes.sql`, extended in `supabase/migrations/0019_mvp2_familia_nueva.sql`), but the ETL quarantine is response-only: nothing enqueues it. The other half of the entry, the ingest acting as a producer for products with no effective technology, was closed by `supabase/migrations/0013_mvp_cierre_bandeja_ingesta.sql` with a different type, so the reserved name stays free for items that truly could not be processed.

### B2-4 · Fallback brand for rows whose brand cell holds a warehouse name

**Status: open, business decision.** A source row whose brand column actually contains a warehouse name is assigned a placeholder brand (`MARCA_FALLBACK_WEST` in `src/services/etl/runEtl.ts`). It is reversible only by changing that constant, or the workbook, and ingesting again: no admin-editable layer covers the brand (`productos_override.campo` admits only `familia`, `descripcion` and `tecnologia` in `supabase/migrations/0044_fixb1_tecnologia_editable_excel_gana.sql`, and the brand is read from the source in `src/services/derivaciones.ts`). The constant should move to configuration if the business picks another target.

### A1-9 · `LIMIT/OFFSET` pagination without `ORDER BY` can repeat and skip rows

**Status: open, ratcheted.** `fetchAllRows` (`src/lib/supabase/fetch-all.ts`) pages with `.range(from, to)`, and Postgres promises no order without `ORDER BY`; the ingest upserts the same table, which is the pathological case. Fixed sites are annotated, the remaining ones are inventoried by `src/lib/supabase/orden-estable.test.ts`, a ratchet whose counter cannot go up without turning the suite red. Trigger: any catalogue or dashboard figure that "moves" with no data change.

### EL-TRINQUETE-NO-VE-LECTURAS-SIN-TOPE · The ratchet cannot see reads with no bound

**Status: open, low.** The ratchet of A1-9 sees `.range(` and `fetchAllRows`, not a `SELECT` with neither `.range` nor `.limit`, which is exactly the shape that `loadPrevState` once had. The paginated variant of the fail-fast check exists (`src/services/etl/persist.ts`); the header of `src/lib/supabase/orden-estable.test.ts` declares what the guard cannot see.

### B10-3 · Snapshots record RESULTS, not ATTEMPTS

**Status: open.** When the content hash did not change the ETL returns the previous snapshot without persisting (`src/services/etl/runEtl.ts`), so "ran and found nothing new" and "did not run" leave the same evidence: none. The silent-source alarm (`fuentesCalladas` in `src/lib/avisos.ts`) is therefore ambiguous. The corpus avoided the same hole by recording looks, not only changes (`supabase/migrations/0035_b11_frescura_corpus.sql`, `src/lib/corpus/frescura.ts`); the same idea for ingestion needs an attempts table.

### B10-4 · The silent-source threshold compares one source against another

**Status: open.** `fuentesCalladas` in `src/lib/avisos.ts` fires when one source is quiet while the other speaks, but the two sources have different base cadences, so that state is normal part of the time. Comparing each source against its own history reduces noise but fits the observed maximum (P20) and does not remove the ambiguity of B10-3.

### B9-1 · The panel window is time-based, not load-based

**Status: open.** The activity panel cuts by a fixed number of days (`DIAS_VENTANA` in `src/services/avisos.service.ts`), a measured assumption about future cadence. If loads become sparser the panel would say "no movement" about a period that had some. The robust fix cuts by the last N loads per source. Trigger: the first gap between loads longer than the window.

### B8-10 · User-originated data has no backup

**Status: open.** Projects, project lines, follow settings and notification preferences (`supabase/migrations/0024_b8_proyectos.sql`, `supabase/migrations/0026_b9_seguimientos.sql`, `supabase/migrations/0027_b91_correo.sql`) cannot be rebuilt by re-ingesting the workbooks, unlike every derived table. The price of this entry rises with every block that adds originated data; the assistant conversation was deliberately not persisted for this reason (B10-7).

### B82-1 · Read-merge-upsert windows lose a concurrent edit (two limitations)

**Status: open.** (a) *The race*: `volcarSeleccion` in `src/services/proyectos.service.ts` reads lines, classifies and upserts; another tab can change a quantity in between and that change is lost. (b) *Ambiguity by value*: two identical, concurrent dumps cannot be told apart from one. The remedy is compare-and-set in the database or a per-column `UPDATE`, which is a migration. The assistant usage counter avoids the same race with an advisory lock (`supabase/migrations/0028_b10_chat.sql`).

### B91-2 · Preferences use the same read-merge-upsert window

**Status: open.** `guardarPreferencias` and `seguirSku` in `src/services/avisos.service.ts` read, merge a patch and upsert the full row. The same class as B82-1(a), with less damage (a preference, not a quantity). Trigger: the first "it switched itself off" report.

### MVP2-1 · Image upload is not atomic

**Status: open.** `src/services/imagenes.service.ts` writes the storage object and then the metadata; if the second fails an orphan object remains. Both obvious alternatives are worse (metadata pointing to a file that does not exist yet, or a compensating delete that can also fail).

### B8-1 · `piezas_en_camino` has several loose implementations

**Status: open.** The in-transit quantity (`piezas_en_camino`) is computed in more than one service (`src/services/sku.service.ts`, `src/services/dashboard.service.ts`, `src/services/derivaciones.ts`). `esRetrasado` is deliberately left out of `enRiesgo` in `src/services/derivaciones.ts` so as not to write one more copy before consolidating. No cross-test compares those numbers with each other.

### MARCA-NUEVA-ENTRA-EN-SILENCIO · A new brand is registered without asking anyone

**Status: open.** `resolveMarca` returns `{ nueva }` and the caller registers the brand without queueing anything (`src/services/etl/catalogs.ts`), while a new *family* does ask in the inbox (`supabase/migrations/0019_mvp2_familia_nueva.sql`). The catalogue can therefore grow unattended, and a rule defined by brand (`src/lib/marcas/gobierno.ts`, `supabase/migrations/0039_vert_b2_exclusion_por_marca.sql`) is exactly what needs watching. Leftover products of an excluded brand that no longer appear in the workbook can make the product sheet show two notices at once, which is why its header accumulates notices (`src/components/ficha/ficha-header.tsx`).

### VERTICAL-FUERA-POR-EL-DATO · A retired technology is excluded by the data, not by a rule

**Status: open, low.** One technology value stays active in the technologies table and is left out of the selectable list only because no visible product uses it (`tecnologias_seleccionables` in `supabase/migrations/0044_fixb1_tecnologia_editable_excel_gana.sql`; its guard demands that only when applied). If a load brings it on a visible product the list offers it and the database accepts it silently. Trigger: that first load.

### A1-1 · The classification layer (v2) is frozen and drifts from the source

**Status: open.** The classification layer `clasificacion_v2` is frozen (technology is now read from the product row, `supabase/migrations/0036_cat_b1_tecnologia_y_producto.sql`), so it drifts from the workbook. A drift flag makes the divergence visible (`src/lib/drift-familias.ts`, `src/services/drift-familias.service.ts`) but reconciles nothing. Whether to re-run, freeze or reconcile line by line is a product decision.

### A1-2 · Family-to-document bridges lose their path by SKU

**Status: open.** The witness counts the documents still reachable by the one path a user walks (`puentesSinCamino` in `src/lib/drift-familias.ts`, P27). Re-linking is manual today because writing proposals from the portal needs a grant and a policy on a table that is read-only for signed-in users.

### PROYECTO-ACTIVO-NO-EXISTE · "Active projects" does not exist in the database

**Status: open.** The projects table has no status column, and its owner is the creating account, not an assigned KAM (`supabase/migrations/0024_b8_proyectos.sql`). The newsletter header therefore says "projects", not "active projects" (`src/lib/correo-plantilla.ts`, test in `src/lib/correo-plantilla.test.ts`). Closing it takes a status column and a project-to-KAM link, which reopens an earlier ownership decision.

### RUTA-EMBARQUES-CAMBIA-DE-SIGNIFICADO · A route changed meaning instead of being retired

**Status: accepted.** `/embarques` used to serve the history and now serves the active pipeline, so an old bookmark lands on different content with no error. A sibling route that was retired answers a permanent redirect; no redirect can protect this one because the risk comes from reusing the path (`next.config.mjs`, `src/app/(app)/embarques/`).

### DOS-CONTEOS-GLOBALES-SIN-SUPERFICIE · Two of the global counts lost their surface

**Status: open.** After a card was retired, two counts (reservation mismatches and moved families) are computed but no longer shown anywhere that is not the other count's link (`src/services/dashboard.service.ts`, `src/components/dashboard/dashboard-accesos-rapidos.tsx`, `src/components/dashboard/dashboard-view.tsx`). The notification bell does not cover them.

### DOS-FILTROS-VIVOS-SIN-PUERTA · Two live URL filters had no UI entry

**Status: closed.** `?divergencia=1` on the catalogue and `?retrasado=1` on the shipments pipeline stayed live when the alerts card was retired, but that card had been the only place that emitted them (`src/components/catalogo/catalogo-view.tsx`, `src/components/cruce/cruce-view.tsx`). Two links in the dashboard quick-access list now do (`src/components/dashboard/dashboard-accesos-rapidos.tsx`), and a test fails if either link disappears (`src/components/dashboard/dashboard-view.test.tsx`). The counts the card showed did not come back (see DOS-CONTEOS-GLOBALES-SIN-SUPERFICIE).

### EL-PULSO-AGREGA-POR-SKU-Y-MEZCLA-EMBARQUES · The pulse aggregates by SKU across shipments

**Status: open, low.** `agregarPorSku` (`src/lib/avisos.ts`) takes the "from" stage of the first row and the "to" stage of the last row of a SKU in the window, even if they belong to different shipments; the "N SKUs advanced" line therefore also counts SKUs that end on the same stage. The tie on `detectado_en` is broken by `id` in `leerCambios` (`src/services/avisos.service.ts`).

### RESERVAS-CONCENTRACION-VS-DISPERSION · An unanswered question the data almost supports

**Status: opportunity, not a defect.** The by-KAM reservations card answers "who has the most reserved pieces"; it does not answer "who concentrates and who disperses" (`src/components/dashboard/dashboard-reservas-kam.tsx`, `src/services/dashboard.service.ts`).

### B7B-10 · A KPI line was derived by subtraction across two modules

**Status: closed (by retiring its use).** `conFilaSinTecnologia` (`src/components/dashboard/dashboard-kpis.tsx`) subtracts two counts and clamps at zero, and it was taken out of the render because the subtraction relied on an invariant that lived in another module (`sin_v2` contained in `sin_tecnologia`, in `src/services/dashboard.service.ts`). That invariant was later repealed by decision, and the function now feeds no render: its only consumer is its own test (`src/components/dashboard/dashboard-kpis.test.tsx`). The rule it leaves: if that population is needed again, compute it as an additive field next to the two counts in the service, not as a subtraction in a component.

### TAXO-6 · The migration verifier is static analysis, not a compiler

**Status: open.** Green means "the RAISE balance is not broken", not "the migration compiles": it does not catch missing tables, columns or functions, incompatible types, undeclared plpgsql variables or dependency order (`scripts/verificar-migracion.mjs`, section "what it does not catch"). Mitigation: always compile inside a `BEGIN ... ROLLBACK` first (`scripts/compilar-migracion.mjs`) and replay the full chain (P21, `docs/decisions/0005-migration-guards-and-replay.md`).

## Roles and migrations

### DISPARADOR-DE-DESESTACIONAR-UN-ROL-NO-ESTA-MECANIZADO · Nothing goes red when a parked role's migration lands

**Status: open.** `ROLES_SIN_CARRIL_EN_LA_BASE` parks the roles that exist in the type but that the database still rejects, and `ROLES` is what the UI offers; each role is in exactly one list, and that split *is* mechanical (`src/lib/roles.ts`, `src/lib/roles.test.ts`). What is not mechanical is noticing that the enabling migration has landed: a static test asserts about code, the ledger is execution state. A role can end up built, tested and invisible.

## Documents, interface and tests

### WORKER-DESINCRONIZADO · The PDF worker file can be missing or out of sync with its package

**Status: closed, born with its guard.** `public/pdf.worker.min.mjs` is a derived artifact (listed in `.gitignore`) copied by a soft-failing `postinstall` (`scripts/copiar-pdf-worker.mjs`, wired in `package.json`). Nothing in `tsc`, the suite (which mocks the PDF library) or `next build` looked at it. The suite now fails closed: `src/components/proyectos/proyecto-documento-previa.test.tsx` checks the file exists and compares its SHA-256 with the one in `node_modules`, with a positive control so the comparison can go red.

### NODE-SIN-FIJAR-Y-PDFJS-EXIGE-22 · The Node version is pinned by `.nvmrc`, not by `engines`

**Status: accepted, with a pointer.** The PDF preview dependency requires a recent Node major. `.nvmrc` pins the version for local work, but `package.json` declares no `engines`, and the hosting platform's setting lives outside the repository, so nothing versioned objects if it changes. Adding `engines` would be a second copy of a value that already lives elsewhere (P33). See `src/services/documento/pdf.ts`.

### SUITE-DE-PRESENTACION-DEPENDE-DE-LA-RED · The document generator downloads images over the network

**Status: closed.** `src/services/documento/pdf.ts` still fetches each row's image URL (with an abort signal and a time budget; `src/services/documento/pdf.presupuesto-tiempo.test.ts`), but the document suite no longer reaches the network. `src/services/documento/documento.presentacion.test.ts` replaces the global `fetch` with the simulated one from `src/services/documento/imagenes-minimas.ts`, which serves a generated minimal PNG for `.png` URLs, a generated minimal WEBP for `.webp` URLs and a 404 for anything else, and records the URLs that were requested. The time-budget tests stub `fetch` with their own doubles, and `scripts/huella-documento.mjs` installs the same simulated `fetch` before it computes a fingerprint. The entry stays for the record.

### PREVIA-Y-DESCARGA-NO-COMPARTEN-BYTES · The preview and the download are two renders

**Status: closed for the preview's download button, open for the rest.** The preview used to show one render while the download performed another GET, so the file that came down was not guaranteed to be the one on screen. The "Download this PDF" button of the preview now saves the blob the screen already holds (`materializarDescarga` in `src/components/proyectos/descargar-documento.ts`, wiring in `src/components/proyectos/proyecto-documento-previa.tsx`). Byte equality across two independent renders was never reachable (the PDF library stamps a per-document ID), so the guarantee only holds for the blob the screen holds.

### ROTULO-VIGENTE-EN-CUATRO-SITIOS-Y-SOLO-TRES-SE-ALINEARON · One label, several surfaces, not all aligned

**Status: closed.** The wording for "no longer in the current inventory" appears in the summary bucket, the row status, the footnote, the notes column of the spreadsheet and the portal row; they were aligned and the test pins them together (`src/services/documento/documento.presentacion.test.ts`, `src/services/documento/modelo.ts`, `src/components/proyectos/proyecto-partida-fila.tsx`).

### ROTULO-OCUPADO-NO-CONCUERDA-CON-SU-NOMBRE · A busy label no longer matches the accessible name

**Status: open, low.** Several buttons switch their visible text to "Generating..." and keep their `aria-label`, so while busy the visible label is not contained in the accessible name (WCAG 2.5.3). The sweep in `src/components/proyectos/proyecto-detalle-view.test.tsx` measures the idle state only (`src/components/proyectos/proyecto-exportar-botones.tsx`, `src/components/proyectos/proyecto-documento-previa.tsx`).

### PAR-SIN-ETIQUETA-SE-LEE-COMO-PARTE-SOBRE-TODO · A bare pair is read as part-over-whole

**Status: mitigated.** `reserved / total` is read by convention as a part over a whole, while here the larger number comes first. A column header and `scope="col"` now give readers somewhere to look, but the shape still contradicts the convention (`src/components/dashboard/dashboard-top-sobre-reservados.tsx`, test beside it). It is the declared residue of a product decision, not a pending task.

### SOBRE-RESERVADO-SIN-COPY · A negative "available" had no agreed wording

**Status: closed.** When more is reserved than exists, the row shows the real negative number in amber together with the agreed label `Sobre reservado` (`COPY.sobreReservado`); rounding to zero would lie and hiding it would let a KAM promise committed pieces (`src/lib/correo-plantilla.ts`, pinned by `src/lib/correo-plantilla.test.ts`).

### GATE-DE-CARGA-LEE-PROSA · A name-surface gate swept raw source including comments

**Status: closed.** The gate that ties the loading announcement (what a screen reader hears) to its source now strips comments before sweeping, because a deleted real label that is still mentioned in a comment in the same file left it green (`src/lib/nav-nombres.test.ts`, P34).

### ESQUELETO-Y-VISTA-NO-SE-COMPARAN · A grid literal was copied into view, skeleton and evidence page

**Status: closed.** The geometry now has a single source and a source guard, proven red by giving the skeleton back its own grid (`src/components/proyectos/geometria-lista.ts`, `src/components/proyectos/geometria-lista.test.ts`). The jump between skeleton and view exists only during the transition, which settled-DOM tests cannot see.

### PALETA-DE-PROYECTO-NO-GIRA-CON-EL-TEMA · A fixed-hex palette cannot follow the theme

**Status: open (deferred by design).** Every project has one default look: a colour that comes from a design token (`--mx-proyecto-acento`, with a light and a dark value in `src/app/globals.css`) and a symbol from a closed vocabulary of seven (`src/components/proyectos/apariencia-proyecto.ts`). Nothing in the project cards is a fixed hex today. The palette of six fixed hex values that came with the mockup was left out on purpose: a colour picked per project from fixed hex values could not rotate with the light and dark themes, and the theme guard looks only at `src/app/globals.css`, so no test would see it. That is a pending design decision, to be made before a per-project colour is added.

### PARSER-DE-GLOBALS-LEE-COMENTARIOS · The token parser reads `src/app/globals.css` raw

**Status: open.** `tokensDeRoot` (`src/services/documento/tokens.globals.test.ts`) never strips comments, so (a) a comment that names a token swallows text up to the next `;`, and (b) a closing brace inside a comment truncates the `:root` block. The header of `src/app/globals.css` warns about it; the fix is one line (strip comments first) with a positive control in both directions (P34).

### STRIPPER-DE-FUENTE-SE-COME-DESDE-UN-BLOQUE-FALSO · The comment stripper opens a false block

**Status: open.** `sinComentarios` in `src/lib/guardas/codigo-fuente.ts` removes `/* */` blocks before `//` lines, so a `/*` inside a line comment opens a block that only closes at the next real `*/`; a guard that searches that stretch is green without having read it. Fixing the order (lines first, blocks second) touches every guard that shares the helper, so it needs its own change and its own positive controls (P34).

### NAV-MOVIL-TRAGA-EN-SILENCIO · A renamed route can silently drop a mobile nav item

**Status: open, low.** The bottom bar looks each `href` up in `NAV_ITEMS` and returns `null` when it is missing (`src/components/layout/bottom-nav.tsx`), so a renamed route removes its item with no error. The name gate catches it in tests (`src/lib/nav-nombres.ts`, `src/lib/nav-nombres.test.ts`); on screen it still swallows. Fix: fail loudly, or derive the bar from `NAV_ITEMS`.

### RIEL-DETALLE-SIN-GUARDA-VISUAL · The rail's only detail panel is never measured

**Status: open.** The detail of the pipeline rail lives in a panel that is born `invisible` and appears on hover or focus (`src/components/dashboard/dashboard-pipeline.tsx`); `scripts/layout-check.mjs` never hovers or focuses, so a panel that overflowed the screen would not be caught. DOM tests assert it exists and is tied with `aria-describedby`, which is something else.

### B81-2 · Nothing checked that the document tokens still matched the stylesheet

**Status: closed.** The origin of each token is data, not a comment (`PROCEDENCIA` in `src/services/documento/tokens.ts`), and `src/services/documento/tokens.globals.test.ts` compares each value with the light-theme `:root` block of `src/app/globals.css`. The value stays duplicated (the generator runs server-side without CSS) but can no longer drift silently.

### FR-1 · The remount-on-refetch anti-pattern in two views

**Status: closed.** `src/components/config/config-familias.tsx` and the pending-items inbox now keep the view mounted and mark it busy, each with its own gate (`src/components/config/config-familias.tsx`, `src/components/pendientes/bandeja-view.tsx`, `src/components/pendientes/bandeja-view.test.tsx`; P3).

### B5-3 · Duplicated temporary-password block

**Status: closed.** One shared component renders the temporary password and its copy button (`ContrasenaTemporalCampo` in `src/components/config/config-usuarios.tsx`).

### B11-1 · The repository cannot check that something FITS

**Status: mitigated, with self-declared gaps.** Neither `jsdom` nor `renderToStaticMarkup` computes layout, so UI guards check class text, not effect (P25). The instrument that does measure is a headless layout check that is run on purpose (`npm run layout-check`, `scripts/layout-check.mjs`, with `src/lib/layout-check/`), whose limits are A1-12, A1-13 and A1-15. A planted-defects page exists only for it (`src/app/(app)/control-layout/page.tsx`).

### A1-12 · The layout check's positive controls are incomplete

**Status: open.** One assertion (page overflow) emits a fixed "planted: null" and so cannot be controlled without changing its emitter; the planted defects are anchored to fixed pixel sizes, so they certify the predicate, never the width axis (`src/lib/layout-check/predicados.ts`, `src/lib/layout-check/veredicto.ts`). Trigger: the next change to the instrument, or before signing a run as width coverage.

### A1-13 · The layout check only looks at the horizontal axis

**Status: open.** The check measures `scrollWidth` against `clientWidth`, but what clips on narrow screens is `line-clamp-*`, which is `overflow: hidden` on the block axis. `src/lib/layout-check/predicados.ts` has no `scrollHeight` branch. A new branch needs its own threshold in height pixels and its own planted defect, in the same commit.

### A1-15 · The layout check measures the administrator's screens, not the `kam` ones

**Status: open.** The check navigates with one session, an administrator, because that role sees every screen and every navigation item; since a run was once measured with the wrong role, it reads `perfiles.rol` after opening the session and ends without a verdict (`SIN VEREDICTO`) if the role is not `admin` (`src/lib/layout-check/escenarios.ts`, `scripts/layout-check.mjs`). That closes a hole in the instrument and leaves unmeasured what a `kam` sees, which is the role every new account is born with (`handle_new_user` in `supabase/migrations/0002_rls.sql`). Trigger: before signing a layout run as coverage of every role.

### GATE-DE-CONTROL-LAYOUT-SIN-PRUEBA · The gate of the layout-check control page had no test

**Status: closed.** The page `/control-layout` exists only inside a layout-check run: a gate on the exact value of `LAYOUT_CHECK` hides it (`src/app/(app)/control-layout/page.tsx`), and for a time nothing watched that rule, so relaxing it to "the variable is defined" would have turned nothing red. `src/app/(app)/control-layout/gate.test.tsx` now proves that without the variable, or with a value other than `1`, the route answers `notFound()`, that with `LAYOUT_CHECK=1` the page is built (the positive control), and that the three copies of the value (the two control-page gates and `scripts/layout-check.mjs`) agree. The sibling page has the same test (`src/app/(app)/control-estados/gate.test.tsx`).

### B8-8 · Timeouts sized for an idle machine in tests that spawn real processes

**Status: open, mitigated twice.** The tests of the migration applier and verifier run a Node process per case, so under load they exceed the default test timeout. They now carry an explicit timeout (`vi.setConfig({ testTimeout: ... })` in `scripts/aplicar-migracion.test.ts`, and the sibling `scripts/verificar-migracion.test.ts`). The rule is not to raise a timeout to make a test pass: the cap is information about the environment.

### GUARDA-DE-LISTA-CARA-SIN-CAUSA-MEDIDA · Two source guards failed by time, not by logic

**Status: closed with an explicit cap.** Two guards that take about a second alone failed repeatedly under the full suite against the default timeout; they now carry an explicit cap with the observed samples written beside it instead of a derived factor (`src/lib/hooks/contrato-de-lista.test.ts`).

### B8-9 · The pre-commit rule existed on paper and had no mechanism

**Status: closed.** A convention with no mechanism is the P7 of process. `.githooks/pre-commit` now runs `tsc --noEmit`, installed by the `prepare` script (`git config core.hooksPath .githooks` in `package.json`). It does not run the suite or the build; `npm run verificar` does (`tsc --noEmit && vitest run && next build`).

## Assistant

### B10-5 · Rejected requests leave no row

**Status: accepted.** When the usage ceiling rejects a request, no row is written, so "how many times did people hit the ceiling" cannot be queried from the table (`supabase/migrations/0028_b10_chat.sql`, table `consumo_chat`). This is deliberate: if a rejection left a row, a rejected loop would write unboundedly and the limiter would become the vector. The question must be answered from application logs.

### B10-6 · Zero-state suggestions embed an example SKU

**Status: open, info.** The suggestion chips carry a baked-in example SKU so that a click does not call the model (`src/lib/chat/intenciones.ts`); if that SKU left the catalogue the chip would answer "not found" instead of a card. Trigger: the first chip that answers "not found".

### B10-7 · The conversation is not persisted

**Status: accepted.** It lives in tab memory (`src/components/chat/burbuja-chat.tsx`). Storing it would make it user-originated data (a table, RLS and the backup problem of B8-10, with free text that may name customers); `localStorage` is per browser, not per account, so on a shared machine one user would see another's chat.

### B10-9 · "Named a SKU" versus "asked something unknown about a SKU" is a text comparison

**Status: open, bias declared.** `esSoloElNombre` in `src/lib/chat/enrutador.ts` normalizes the term and requires that what was typed *is* the SKU. It covers the bare code, with punctuation, or with an article, and does not cover "code please". The two errors cost differently: a false negative returns the "I don't know" that lists options; a false positive would turn a refusal into three buttons and hide the limit of the catalogue. The bias is pinned in `src/lib/chat/enrutador.test.ts` and the control is in `src/lib/chat/evaluacion.ts`.

### B11-3 · The corpus condition is compared apart, not hidden

**Status: open.** The retrieval evaluation normalizes accents with a helper, because some indexed chunks lost their accents at the source; the corpus condition itself is kept as a debt and compared separately instead of being masked (`src/lib/chat/evaluacion-rag.ts`).

### HILO-SIN-CALIBRAR · The conversation thread caps are a declared starting point

**Status: open, low.** `TOPE_TURNOS_HILO` and `TOPE_BYTES_HILO` in `src/lib/chat/hilo.ts` are not measurements; calibrating them needs to know how people re-ask, and that cannot be measured because the usage table does not store the question text (B10-5). Either the numbers are accepted with this entry or that decision is lifted.

### UNA-LISTA-FIJA-SOBRE-UN-CORPUS-QUE-CRECE-ENVEJECE-SOLA · A hand-written list over a corpus that grows

**Status: closed for questions about the assistant itself, open for the rest.** The questions about the assistant come from a query and grow by themselves; the capabilities card still lists the intents by hand (`INTENCIONES` in `src/lib/chat/intenciones.ts`; `src/services/sobre-mi.service.ts`, `src/services/chat.service.ts`). Today it is correct because the set of intents is closed; nothing compares it with what the system can actually do.

## Newsletter workflow

The example workflow is `n8n/boletin-semanal.json`; its rules and import steps are in `n8n/README.md`, and its guard test is `n8n/workflows.test.ts`.

### B91-4 · A credential in clear inside a workflow export

**Status: closed by a guard.** Never commit workflow exports with credentials. `n8n/workflows.test.ts` rejects any `credentials` block and any key/value pair whose key sounds like a credential and whose value looks like a secret.

### B91-5 · Separating workflows by naming convention is not a mechanism

**Status: accepted.** On an instance without projects, workflows from different purposes share one namespace and are told apart only by a name prefix; nothing prevents renaming one, or one workflow calling another. The real surface is accidental renaming; trigger: the instance gets a second real consumer, or a workflow that calls another.

### B91-6 · The window is exactly seven days with no overlap

**Status: open.** The `Ventana` ("Window") node computes `desde` as seven days before now (`n8n/boletin-semanal.json`). A missed week leaves an unrecoverable gap; the gap was chosen over overlap on purpose, because overlap would report a change twice, but the gap is silent. The clean fix derives `desde` from the last confirmed send, which would hand the calendar back to the portal.

### REMITENTE-SIN-ALINEAMIENTO-DMARC · A webmail send does not align with the sender's domain

**Status: closed in the example workflow.** The example sends over SMTP (`emailSend`) so that the sender's own domain can sign DKIM; a webmail node signs with its provider's domain and neither SPF nor DKIM aligns. DMARC publishes policy, it does not create alignment: a strict policy would turn "flagged" into "rejected". The deployment must also add the SMTP provider to the existing SPF record (`n8n/boletin-semanal.json`, `n8n/workflows.test.ts`).

### RETRYONFAIL-DEL-ENVIO-REENVIA-A-TODOS · The send node's automatic retry duplicates

**Status: open, medium once there is more than one recipient.** `retryOnFail` is set (two tries) on the send node, `Enviar el correo` ("Send the email") in `n8n/boletin-semanal.json`. n8n decides whether to retry by looking only at item zero and then re-runs the node with all items: if the first recipient fails, the others get a second copy; if another fails, there is no retry. Fix: `retryOnFail: false` plus an assertion in `n8n/workflows.test.ts` that no `emailSend` with `continueErrorOutput` carries it.

### PRECONDICIONES-PARA-ACTIVAR-EL-BOLETIN · A start-up checklist, not code debt

**Status: open, operational.** Publishing the workflow without its preconditions yields a digest that fails silently every week: the portal endpoint must exist in the deployment, the dedicated secret must be set, the credentials created and `url_portal` edited, and the workflow stays inactive until the first manual send. The steps are in the "Importing the workflow" section of `n8n/README.md`.

## Keeping this page honest

An entry stays here after it is closed, because the code still cites its ID. A limitation is only added with the file that shows it; a figure that was not measured is not written (P29). New limitations are discovered mostly by the process described in `docs/ai-assisted-workflow.md` and the patterns in `docs/engineering/failure-patterns.md`.

