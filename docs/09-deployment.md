# 09 — Deployment

> Everything you need to deploy, configure, and operate DSCP_AI on **SAP BTP Cloud Foundry** (and run it locally).

For the architecture rationale, see [01-architecture.md](01-architecture.md). For the auth/security side, see [04-auth-and-security.md](04-auth-and-security.md).

---

## 1. Topology

```
┌────────────────────────────────────────────────────────────────────┐
│ SAP BTP — Subaccount: BSH-DSCP                                     │
│   Org: bsh-dscp · Space: dev | qa | prod                           │
│                                                                    │
│   App: dscp-ai (1× instance, 512M memory, 512M disk, python BP)    │
│      ├── bound: dscp-ai-app           (XSUAA)                      │
│      └── bound: DSCP_APPS_Object_DB   (Object Store, S3-compatible)│
│                                                                    │
│   External:                                                        │
│      Microsoft AAD (login.microsoftonline.com) — Brain client_creds│
│      DIA Brain      (ews-emea.api.bosch.com)   — workflow / pure   │
│      Confluence     (inside-docupedia.bosch.com)                   │
└────────────────────────────────────────────────────────────────────┘
```

---

## 2. The deployment artifacts

### 2.1 `manifest.yml`

```yaml
applications:
  - name: dscp-ai
    memory: 512M
    disk_quota: 512M
    instances: 1
    buildpack: python_buildpack
    command: >
      python -m uvicorn app.main:app
      --host 0.0.0.0 --port $PORT
      --proxy-headers --forwarded-allow-ips '*'

    services:
      - dscp-ai-app             # XSUAA binding (xsappname=bsh_dscp_ai_apps)
      - DSCP_APPS_Object_DB     # Object Store binding

    env:
      ENVIRONMENT:        "prod"
      BRAIN_API_BASE_URL: "https://ews-emea.api.bosch.com:443/it/application/dia-brain/v1/api"
      # secrets injected via cf set-env, never committed:
      BRAIN_TENANT_ID:        "SET_VIA_CF_SET_ENV"
      BRAIN_CLIENT_ID:        "SET_VIA_CF_SET_ENV"
      BRAIN_CLIENT_SECRET:    "SET_VIA_CF_SET_ENV"
      SIGNAVIO_BRAIN_ID:      "SET_VIA_CF_SET_ENV"
      AUDIT_CHECK_BRAIN_ID:   "SET_VIA_CF_SET_ENV"
      SESSION_SECRET:         "SET_VIA_CF_SET_ENV"
```

Critical flags:

* `--proxy-headers --forwarded-allow-ips '*'` — without these, `request.url_for("auth_callback")` produces `http://` URLs and XSUAA rejects the redirect.
* `instances: 1` — analytics/history JSON files are **not** locked across instances; do not scale horizontally without adding distributed locking.
* `memory: 512M` — fits comfortably; `python-pptx` + `PyMuPDF` peak around 200–250 MB during heavy generations.

### 2.2 `xs-security.json`

```json
{
  "xsappname":   "bsh_dscp_ai_apps",
  "tenant-mode": "dedicated",
  "scopes": [
    { "name": "$XSAPPNAME.Display", "description": "User can view the application" },
    { "name": "$XSAPPNAME.Admin",   "description": "User can perform administrative tasks" }
  ],
  "role-templates": [
    {
      "name": "BT109D1_UD_DSCP_Apps_Viewer",
      "description": "Standard User Role",
      "scope-references": ["$XSAPPNAME.Display"]
    },
    {
      "name": "BT109D1_UD_DSCP_Apps_Admin",
      "description": "Admin Role",
      "scope-references": ["$XSAPPNAME.Display", "$XSAPPNAME.Admin"]
    }
  ],
  "oauth2-configuration": {
    "token-validity": 3600,
    "redirect-uris": [
      "https://dscpaiapps-shy-dog-rb.cfapps.eu10.hana.ondemand.com/**",
      "https://bsh_dscp_ai_apps-turbulent-gorilla-az.cfapps.eu10.hana.ondemand.com/**",
      "https://*.cfapps.eu10.hana.ondemand.com/**"
    ]
  }
}
```

> The `Admin` scope is for the **XSUAA** role; the **app-level** admin gate (`/dscpadmin`) is enforced separately by `ADMIN_USERS` in [analytics_service.py](../app/services/History/analytics_service.py). Both must be granted for full admin power.

### 2.3 `Procfile`

```
web: python -m uvicorn app.main:app --host 0.0.0.0 --port $PORT
```

Used by buildpacks that prefer Procfile over `command:` — both should match minus the proxy flags (which CF needs).

### 2.4 `requirements.txt`

```
fastapi
uvicorn
jinja2
python-multipart
httpx
pydantic
python-dotenv
itsdangerous
python-pptx
python-docx
Pillow
PyMuPDF

boto3>=1.34.0

cfenv
sap-xssec
requests
babel
```

Roles:
* `fastapi` / `uvicorn` / `jinja2` / `python-multipart` — web stack.
* `httpx` — async HTTP (Brain, XSUAA token exchange, Confluence).
* `pydantic` — request models.
* `python-dotenv` — `.env` loading.
* `itsdangerous` — Starlette `SessionMiddleware`.
* `python-pptx` / `python-docx` / `Pillow` / `PyMuPDF` — document generation + PDF parsing.
* `boto3>=1.34.0` — S3v4 signature support.
* `cfenv` / `sap-xssec` — CF service binding + JWT validation.

---

## 3. Environment variables — full reference

| Variable | Required? | Default | Notes |
|---|---|---|---|
| `ENVIRONMENT` | recommended | `dev` | Set to `prod` in `manifest.yml`. Drives strict TLS, prod log levels, removes proxy env vars. |
| `SESSION_SECRET` | **yes in prod** | dev fallback | Raises `RuntimeError` if missing in prod. |
| `AUTH_BYPASS_LOCAL` | no | `false` | Local bypass: requires this **and** absence of `VCAP_SERVICES`. |
| `VCAP_SERVICES` | auto | — | CF-injected; presence triggers prod auth + Object Store binding lookup. |
| `VCAP_APPLICATION` | auto | — | CF-injected. |
| `BRAIN_TENANT_ID` | **yes** | — | Microsoft tenant for client credentials. |
| `BRAIN_CLIENT_ID` | **yes** | — | |
| `BRAIN_CLIENT_SECRET` | **yes** | — | |
| `BRAIN_API_BASE_URL` | no | `https://ews-emea.api.bosch.com:443/it/application/dia-brain/v1/api` | |
| `BRAIN_PORTAL_URL` | no | `https://brain.prd.dia-apps.bosch.tech/brains/oXV4pyZVEJvy` | Shown in UI footer/help. |
| `SIGNAVIO_BRAIN_ID` | per feature | — | BPMN Builder workflow. |
| `AUDIT_CHECK_BRAIN_ID` | per feature | — | Audit Check. |
| `BPMN_CHECKER_BRAIN_ID` | per feature | — | BPMN Checker. |
| `PPT_BRAIN_ID` | per feature | — | PPT Creator. |
| `DIAGRAM_BRAIN_ID` | per feature | — | Diagram Generator. |
| `ONE_PAGER_BRAIN_ID` | per feature | — | One-Pager. |
| `DOCUPEDIA_BRAIN_ID` | per feature | — | Confluence drafts (pure-LLM). |
| `SIGNAVIO_WORKFLOW_ID` | optional | — | Brain workflow id (if separate from brain id). |
| `OBJECT_STORE_HOST` | local only | — | Used when `VCAP_SERVICES` absent. |
| `OBJECT_STORE_BUCKET` | local only | — | |
| `OBJECT_STORE_ACCESS_KEY_ID` | local only | — | |
| `OBJECT_STORE_SECRET_ACCESS_KEY` | local only | — | |
| `OBJECT_STORE_REGION` | local only | `eu-central-1` | |
| `SSL_VERIFY` | dev only | `true` | `false` allowed only when `ENVIRONMENT != prod`. |
| `SSL_CA_BUNDLE` | optional | — | Path to PEM if behind corp proxy with custom CA. |
| `CLIENT_LOGGING_ENABLED` | no | `true` | Powers `AppLogger` → `/api/client-log`. |
| `CLIENT_LOG_LEVEL` | no | `error` (prod) / `debug` (dev) | |
| `CONFLUENCE_ALLOWED_HOSTS` | no | `inside-docupedia.bosch.com` | Comma-separated SSRF allowlist. |

---

## 4. Service bindings

### 4.1 XSUAA (`dscp-ai-app`)

```bash
cf create-service xsuaa application dscp-ai-app -c xs-security.json
```

The service name must match the `services:` entry in `manifest.yml`. The app reads `VCAP_SERVICES.xsuaa` via `cfenv`/`sap-xssec` ([app/services/auth_service.py](../app/services/auth_service.py)) and falls back to label-based lookup if name lookup fails.

### 4.2 Object Store (`DSCP_APPS_Object_DB`)

```bash
cf create-service objectstore s3-standard DSCP_APPS_Object_DB
```

Credentials are read in [app/core/config.py](../app/core/config.py) `get_object_store_config()`:

1. `VCAP_SERVICES.objectstore[0].credentials.{host, bucket, access_key_id, secret_access_key, region}`.
2. Else `OBJECT_STORE_*` env vars.
3. Else: dev returns `None` (history disabled), prod raises `RuntimeError`.

`boto3` always uses `signature_version="s3v4"` and writes with `ServerSideEncryption="AES256"` ([storage_service.py](../app/services/History/storage_service.py)).

---

## 5. Deployment workflow

### 5.1 First-time deploy

```bash
cf login -a https://api.cf.eu10.hana.ondemand.com
cf target -o bsh-dscp -s dev

# Bind services (only first time)
cf create-service xsuaa application dscp-ai-app -c xs-security.json
cf create-service objectstore s3-standard DSCP_APPS_Object_DB

# Push code
cf push --no-start

# Set secrets (never commit them)
cf set-env dscp-ai SESSION_SECRET            "<32+ char random>"
cf set-env dscp-ai BRAIN_TENANT_ID           "..."
cf set-env dscp-ai BRAIN_CLIENT_ID           "..."
cf set-env dscp-ai BRAIN_CLIENT_SECRET       "..."
cf set-env dscp-ai SIGNAVIO_BRAIN_ID         "..."
cf set-env dscp-ai PPT_BRAIN_ID              "..."
cf set-env dscp-ai DIAGRAM_BRAIN_ID          "..."
cf set-env dscp-ai ONE_PAGER_BRAIN_ID        "..."
cf set-env dscp-ai DOCUPEDIA_BRAIN_ID        "..."
cf set-env dscp-ai AUDIT_CHECK_BRAIN_ID      "..."
cf set-env dscp-ai BPMN_CHECKER_BRAIN_ID     "..."

cf restage dscp-ai
cf start  dscp-ai
```

### 5.2 Subsequent deploys

```bash
cf push        # picks up code + manifest.yml
```

`cf set-env` does **not** auto-restage — call `cf restage dscp-ai` after changing env vars.

### 5.3 Role assignment

In BTP Cockpit → Security → Role Collections:

1. Create role collection `DSCP_AI_Users` and assign `BT109D1_UD_DSCP_Apps_Viewer`.
2. Create role collection `DSCP_AI_Admins` and assign both templates.
3. Map collections to identity provider users / groups.

> Reminder: app-level admin gate (`/dscpadmin`) also requires the user-id (e.g. `dsd9di`) to be in `ADMIN_USERS` in [analytics_service.py](../app/services/History/analytics_service.py). XSUAA `Admin` scope alone is **not** sufficient.

### 5.4 Liveness

CF probes `GET /health` (defined in [app/main.py](../app/main.py)):

```json
{ "status": "healthy" }
```

Returns 200 unconditionally; does **not** check Brain or Object Store reachability so a brief upstream outage does not crash the app.

---

## 6. Local development

### 6.1 Prerequisites

* Python 3.11+
* (Optional) corporate VPN / proxy for `ews-emea.api.bosch.com`
* (Optional) BTP Object Store credentials if you want history persistence locally

### 6.2 Setup

```powershell
# clone & install
git clone <repo>
cd DSCP_AI
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt

# minimal .env at repo root
@'
ENVIRONMENT=dev
AUTH_BYPASS_LOCAL=true
SESSION_SECRET=local-dev-secret-change-me
SSL_VERIFY=false                 # only if behind corp proxy without trusted CA

BRAIN_TENANT_ID=...
BRAIN_CLIENT_ID=...
BRAIN_CLIENT_SECRET=...
BRAIN_API_BASE_URL=https://ews-emea.api.bosch.com:443/it/application/dia-brain/v1/api

# optional — only if you want history locally
OBJECT_STORE_HOST=...
OBJECT_STORE_BUCKET=...
OBJECT_STORE_ACCESS_KEY_ID=...
OBJECT_STORE_SECRET_ACCESS_KEY=...
'@ | Out-File -Encoding ASCII .env
```

### 6.3 Run

```powershell
python main.py
# → http://localhost:8001
# AuthMiddleware bypassed because VCAP_SERVICES absent + AUTH_BYPASS_LOCAL=true
# you log in as user "local-dev"
```

`main.py` uses `uvicorn.run(..., reload=True)` so code edits hot-reload.

### 6.4 Health check

```powershell
curl http://localhost:8001/health
```

---

## 7. Operations runbook

### 7.1 Logs

```bash
cf logs dscp-ai --recent     # last 100 lines
cf logs dscp-ai              # tail
```

What to grep for:

* `XSUAA configured: client_id=True` on startup → binding healthy.
* `RuntimeError: Object Store credentials are missing` → service unbound or restage missed.
* `Brain authentication failed` (502) → check `BRAIN_*` env vars.
* `Could not reach the authentication service` (503) → outbound network issue.
* `Failed to validate confluence url` → user URL outside `CONFLUENCE_ALLOWED_HOSTS`.

### 7.2 Common failures

| Symptom | Likely cause | Fix |
|---|---|---|
| Login redirect loops | `redirect-uris` in `xs-security.json` doesn't match the route URL | Update `xs-security.json`, run `cf update-service dscp-ai-app -c xs-security.json` |
| `http://...` callback URL rejected by XSUAA | Missing `--proxy-headers` flag | Restore `manifest.yml` command, restage |
| `RuntimeError: SESSION_SECRET` on startup | Env var unset in prod | `cf set-env dscp-ai SESSION_SECRET ...; cf restage` |
| `/dscpadmin` returns 403 even for admin user | User-id not in `ADMIN_USERS` | Add to `analytics_service.py`, redeploy |
| History saves return `503` | Object Store unbound or bucket missing | `cf services`, rebind, restage |
| Uploads return `413` | File > 10 MB or total > 10 MB | Reduce input |
| Page shows old CSS after deploy | Browser cache | Bump `CSS_VERSION` in `app/core/config.py` |
| Brain calls hang | Outbound proxy / TLS mismatch | Check `SSL_CA_BUNDLE`, ensure `ENVIRONMENT=prod` strips proxy vars |
| Analytics dashboard empty | First deploy or cleared bucket | Counters lazily created on next click/gen |

### 7.3 Rotating secrets

* `SESSION_SECRET`: rotate freely; existing sessions invalidate. Run `cf set-env … && cf restage`.
* `BRAIN_CLIENT_SECRET`: coordinate with the Brain team; rotate, restage.
* `OBJECT_STORE_*` (when re-binding): `cf unbind-service … && cf bind-service … && cf restage`.

### 7.4 Scaling

* **Vertical**: `cf scale dscp-ai -m 1G`. Most generations stay under 250 MB but PPT with embedded images can spike.
* **Horizontal**: not safe today. The Object Store JSON files are written without distributed locking. Either add a lock (Redis) or stick to `instances: 1`.

### 7.5 Observability

* Server logs: `cf logs` (Python `logging` at INFO).
* Client logs: posted to `/api/client-log` and surfaced in server logs.
* Analytics: `/dscpadmin` (admins only).
* Feedback aggregates: `GET /api/admin/feedback`.

---

## 8. Promotion across spaces

```
dev   → qa   → prod
```

Each space has its own:

* Service instances (`dscp-ai-app`, `DSCP_APPS_Object_DB`).
* `BRAIN_*` IDs (Brain has separate dev/qa/prod environments).
* Redirect URIs in `xs-security.json` (use the wildcard `*.cfapps.eu10.hana.ondemand.com/**` to keep one config).

Suggested CI flow:

1. `cf push` to `dev` on every merge to `main`.
2. Manual promotion: `cf push` against `qa` manifest with the same source.
3. After QA sign-off, push to `prod` with the prod role-collection assignments verified.

---

## 9. Disaster recovery

* **Code**: Git is the source of truth. `cf push` rebuilds from scratch.
* **Object Store**: enable BTP versioning at the bucket level if you need rollback. Otherwise:
  * `analytics/*` is best-effort and self-rebuilding (counters resume).
  * `*-history/{user}/` loss is per-user and unrecoverable from app state.
  * `feedback/*` and `favorites/*` similarly per-user.
* **XSUAA**: re-create with the same `xsappname` to preserve role mappings.

Keep an **off-platform backup** of `BRAIN_*` secrets and `SESSION_SECRET` in a vault.

---

## 10. Verification checklist after every deploy

```
[ ] cf logs dscp-ai --recent  shows: "XSUAA configured: client_id=True"
[ ] GET /health → 200 {"status":"healthy"}
[ ] GET /  redirects unauthenticated user to /login
[ ] /login redirects to https://*.authentication.eu10.hana.ondemand.com/oauth/authorize
[ ] /auth/callback validates state and lands on /
[ ] /api/admin/analytics returns 200 for ADMIN_USERS, 403 for others
[ ] PPT extract end-to-end (upload PDF → slide JSON → save → /api/ppt/history shows entry)
[ ] /static/css/common.css?v=<CSS_VERSION>  returns 200
```

That's the deploy story. Loop back to [02-onboarding.md](02-onboarding.md) for new-developer setup, or [README.md](README.md) for the full doc map.
