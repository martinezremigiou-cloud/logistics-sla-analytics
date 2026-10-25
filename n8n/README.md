# `n8n/` — versioned workflow examples

> **n8n DELIVERS. n8n does not DECIDE.**
> The portal decides which notices exist and whose they are (`derivarAvisos()`),
> and who gets an email (`armarCorreos()`). The portal also renders the email
> template. What n8n owns is the **calendar**, the **channel**, the **retry** and
> the **delivery receipt** — nothing else.

If a workflow here starts querying the database to decide whom to notify, there
will be two truths about the same thing and they will diverge. The workflow is
deliberately thin so that cannot happen.

This directory is an **example** of the pattern, not a deployment recipe: it
contains no credentials, no instance ids and no real domains.

## What is here

| File | What it does |
|---|---|
| `boletin-semanal.json` | Weekly digest. Asks the portal for the week's emails, sends each one over **SMTP** (`emailSend`) and confirms every delivery back to the portal. Imported **inactive**. |
| `workflows.test.ts` | Guard test (runs with `npm test`): no secret-shaped values, no `credentials` blocks, measured node versions, the failure output never reaches the confirmation node, the workflow ships deactivated. |

### Flow

```
Monday 08:00 (schedule)
  -> Window            sets desde / hasta / clave_intento / url_portal
  -> Ask the portal    POST {url_portal}/api/avisos/envios  (header x-avisos-secret)
  -> One per person    splits the `correos` list into one item per recipient
  -> Send the email    SMTP node, onError = continueErrorOutput
        main[0] success -> Confirm delivery   POST {url_portal}/api/avisos/envios/confirmar
        main[1] error   -> "Not confirmed (on purpose)"  (writes nothing)
```

## Rules for this directory

### 1. No secret, ever, in any file here

Workflows are exported **without credentials**: they are assigned in the n8n
instance after importing. An exported workflow is a text file that ends up in a
repository and in a backup. Before committing an export, check:

```bash
grep -nEi '"(value|apikey|token|secret|password|authorization)"\s*:\s*"[A-Za-z0-9_/+=-]{16,}"' n8n/*.json
```

It must print nothing. `workflows.test.ts` enforces the same rule, and also
rejects any `credentials` block (credential ids tie a file to a single instance).

### 2. The portal secret is dedicated, and n8n never sees the database key

`SUPABASE_SERVICE_ROLE_KEY` bypasses RLS; n8n **never receives it**. n8n only
holds `AVISOS_SECRET`, a dedicated secret modelled on `INGEST_SECRET`. It is not
"low privilege" just because the endpoint is read-oriented: treat it as a
high-privilege secret.

### 3. Node versions are measured, not assumed

A `typeVersion` higher than the instance supports makes the whole import fail.
`workflows.test.ts` keeps two tables: versions measured against a running
instance, and versions that are declared assumptions (`scheduleTrigger`,
`splitOut`, `noOp`, `emailSend`). If n8n rejects an assumed version on import,
the number to fix lives in one place.

### 4. A failed send must never be confirmed

`continueRegularOutput` pushes the **failed** item down the main output, so the
confirmation node would treat it as a success and the delivery alarm would be
silenced by the channel it is supposed to watch. The workflow uses
`continueErrorOutput`: main[0] is success, main[1] is error and goes to a no-op
node. A failed send is not confirmed, the window still counts as not delivered,
and the next run delivers it again. Two tests guard this (the forbidden mode, and
the wiring of the error output).

### 5. Idempotency lives in the portal

`clave_intento` (for example `semanal-2026-W40`, the ISO year-week) is an opaque
key: the portal enforces `UNIQUE (perfil_id, clave_intento)` (migration 0027), so
retrying a run never produces two rows for the same profile and key. The table
does not store the body: the portal recomputes the notices and the emails from
live data on every call and records the attempt with `ignoreDuplicates`
(`src/services/correo.service.ts`), so a retry may carry newer content than the
first attempt. Two runs of the same week produce the same key, and the portal
uses it to leave out only the profiles whose send is already confirmed
(`estado = 'enviado'`, set by `/api/avisos/envios/confirmar`), so a second run
does not repeat the email to them. A profile still in `preparado` is a candidate
again on every call and the key does not prevent a resend: that asymmetry is
deliberate (a duplicate email is preferred to a lost one). The automatic retry
of the send node has its own limitation, `RETRYONFAIL-DEL-ENVIO-REENVIA-A-TODOS`
in [known-limitations.md](../docs/known-limitations.md).

- The window is exactly 7 days with no overlap. If a week does not run, those
  days are **not** recovered: a gap is preferred over reporting the same change
  twice.
- Test or rehearsal runs must use a literal key that cannot collide with a real
  weekly key (for example `ensayo-<date>-a`), otherwise the first runner consumes
  the window of the second.
- `solo_perfiles` is an optional field of the request body that restricts the run
  to a list of profile ids. It is **not** defined in the exported workflow; add it
  to the `Window` node only for a scoped rehearsal. When the key is absent
  `JSON.stringify` omits it and the body is identical to the normal run.

## Importing the workflow

1. **Create the secret in the portal**: set `AVISOS_SECRET` (at least 16
   characters) in the deployment environment. Never paste it in a chat.
2. **Create the credentials in n8n**:
   - a *Header Auth* credential with header name `x-avisos-secret` and the secret as value;
   - an *SMTP* credential for the sending domain.
3. **Import** `boletin-semanal.json`.
4. **Assign** the credentials to the three nodes that need them (the two HTTP
   nodes and the SMTP node); the export carries none.
5. **Edit `url_portal`** in the `Window` node: the exported value is the local
   portal (`http://127.0.0.1:3000`), which an n8n instance running elsewhere
   cannot reach.
6. **Keep the workflow inactive** until the first manual send has gone out and
   been confirmed by hand. The "silent channel" alarm does not fire while no send
   has ever been confirmed (never is indistinguishable from not configured yet),
   so until that first send nobody is watching the channel.

The workflow declares `settings.timezone = America/Mexico_City`. Without it the
schedule would follow the instance clock, and "Monday 08:00" would drift with
that zone's daylight-saving changes.
