# 02 — Onboarding (A → Z for a new developer)

This page assumes you have **never seen this repo before**. By the end you will:

* Run the app on your laptop.
* Understand the mental model well enough to ship a small change.
* Know exactly which file to edit for any given task.

---

## A. Required tooling

| Tool | Version | Why |
|---|---|---|
| Python | 3.11+ | FastAPI runtime |
| pip / venv | bundled | dependency install |
| Cloud Foundry CLI | `cf v8` | deployments to BTP |
| Git | any | obviously |
| VS Code | recommended | the workspace ships Copilot instructions |
| Bosch VPN | when calling Brain or Confluence | corporate-only endpoints |

You do **not** need Docker, Node.js, a DB server, or Redis. There is no DB and no separate service.

---

## B. First-time setup (10 minutes)

```powershell
# 1. clone
git clone <repo-url> DSCP_AI
cd DSCP_AI

# 2. virtualenv
python -m venv venv
venv\Scripts\activate

# 3. install
pip install -r requirements.txt

# 4. create a local .env at the repo root (see section C)
notepad .env

# 5. run
python main.py
# → http://localhost:8001
```

`main.py` is a thin shim. The real app is `app.main:app`. `python main.py` starts uvicorn with reload.

---

## C. The local `.env` you need

Create `.env` at the repo root. The minimum to **boot** the app and skip auth:

```dotenv
# Bypass XSUAA locally
AUTH_BYPASS_LOCAL=true
ENVIRONMENT=dev
SESSION_SECRET=local-dev-secret-not-used-but-set-anyway
SSL_VERIFY=true

# Brain (only required if you want AI to actually work)
BRAIN_TENANT_ID=...
BRAIN_CLIENT_ID=...
BRAIN_CLIENT_SECRET=...
BRAIN_API_BASE_URL=https://ews-emea.api.bosch.com:443/it/application/dia-brain/v1/api
SIGNAVIO_BRAIN_ID=...
AUDIT_CHECK_BRAIN_ID=...
BPMN_CHECKER_BRAIN_ID=...
PPT_BRAIN_ID=...
DIAGRAM_BRAIN_ID=...
ONE_PAGER_BRAIN_ID=...
DOCUPEDIA_BRAIN_ID=...

# Object Store (only if you want history to persist locally)
OBJECT_STORE_HOST=...
OBJECT_STORE_BUCKET=...
OBJECT_STORE_ACCESS_KEY_ID=...
OBJECT_STORE_SECRET_ACCESS_KEY=...
OBJECT_STORE_REGION=eu-central-1
```

> Without Object Store credentials the app still boots: history APIs return *Storage unavailable*, analytics counters silently no-op. That's by design (best-effort).

> Without Brain credentials any AI call returns a friendly error message. That's by design too.

The auth bypass requires **both** `AUTH_BYPASS_LOCAL=true` **and** the absence of `VCAP_SERVICES`. Removing either gate re-enables XSUAA.

When auth is bypassed, the synthetic user is `{"user": "local-dev", "email": "local@dev.local", "scopes": []}`. `local-dev` is in the `ADMIN_USERS` set, so you can hit `/dscpadmin` immediately.

---

## D. Walking the codebase in 5 minutes

Open these files in this order. Each is small.

1. [main.py](../main.py) – just calls uvicorn.
2. [app/main.py](../app/main.py) – reads `.env`, builds `FastAPI()`, mounts middleware (4 of them), wires `/login`, `/auth/callback`, `/logout`, `/health`, includes the two routers, attaches a global error handler.
3. [app/core/config.py](../app/core/config.py) – constants, `get_ssl_context()`, `get_object_store_config()`.
4. [app/routers/pages.py](../app/routers/pages.py) – every HTML page. Every route is ≤ 5 lines.
5. [app/routers/api/](../app/routers/api/) – the JSON layer, split per feature. Each file is small and follows the same shape.
6. [app/services/auth_service.py](../app/services/auth_service.py) – XSUAA helpers.
7. [app/services/brain_auth.py](../app/services/brain_auth.py) – AAD client_credentials.
8. [app/services/common_service.py](../app/services/common_service.py) – the *only* file that talks to DIA Brain over HTTP.
9. [app/services/History/storage_service.py](../app/services/History/storage_service.py) – S3 wrapper.
10. [app/services/History/common_history.py](../app/services/History/common_history.py) – generic CRUD over Object Store keys.
11. One feature service of your choice, e.g. [app/services/ppt_creator_service.py](../app/services/ppt_creator_service.py).
12. The matching template + JS pair, e.g. [app/templates/ppt_creator.html](../app/templates/ppt_creator.html), [app/static/js/ppt_creator.js](../app/static/js/ppt_creator.js).

If you can describe in one sentence what each of those files does, you understand the system.

---

## E. The mental model in one paragraph

> Every page route does the same three things: look up the current user, fire-and-forget an analytics click, render a Jinja template. Every API route does the same shape: validate input with Pydantic, call a feature service, translate the result into a `JSONResponse` (or stream a file). Every feature service does the same shape: call `common_service` to talk to Brain, optionally call `History/*` to persist results. Every persistence call writes JSON blobs to one S3 bucket. There is no DB, no queue, no worker. It's flat, async, and replaceable end-to-end.

---

## F. Adding a new app — full recipe

Suppose you want to add **"Risk Assessor"** (`risk` app key).

1. **Backend service**: create `app/services/risk_service.py`. Use `common_service.create_chat_history`, `upload_attachments`, `call_brain_workflow_chat`. Mirror an existing service.
2. **API endpoints**: create [app/routers/api/risk.py](../app/routers/api/) with its own `router = APIRouter()` and Pydantic models for `POST /api/risk/extract`, `POST /api/risk/refine`, etc. Register it in [app/routers/api/__init__.py](../app/routers/api/__init__.py) via `router.include_router(risk.router)`. Validate uploads with `_validate_magic` and `MAX_UPLOAD_SIZE` from [`_shared.py`](../app/routers/api/_shared.py). On success, call `track_generation("risk")`. On failure, `track_generation_failed("risk")`.
3. **History (optional)**: create `app/services/History/risk_history_service.py` that wraps `common_history` with prefix `"risk-history"`. Add `/api/risk/history*` endpoints — copy the PPT block. Always go through `_validate_gen_id`.
4. **Page route**: add `/risk-assessor` to [app/routers/pages.py](../app/routers/pages.py); call `track_click("risk", user_id)` and render the template.
5. **Template**: `app/templates/risk_assessor.html` extending `base.html`. Add `extra_css` and `extra_js` blocks with a `{{ css_version }}` query string.
6. **Frontend**: `app/static/css/risk_assessor.css` and `app/static/js/risk_assessor.js`. **Reuse** `common.css` design tokens and `common.js` helpers (`Utils.apiRequest`, `showToast`, `escapeHtml`, `HistoryIcons`).
7. **Analytics**: add `"risk": "Risk Assessor"` to `APP_LABELS` in [analytics_service.py](../app/services/History/analytics_service.py). Add a colour to `APP_COLORS` in [admin.js](../app/static/js/admin.js).
8. **Favourites (optional)**: add `"risk"` to `ALLOWED_APP_KEYS` in [favorites_service.py](../app/services/History/favorites_service.py).
9. **Env**: add `RISK_BRAIN_ID` to your `.env` and to `manifest.yml` placeholders.
10. **Test**: hit `/risk-assessor` (page), `/api/risk/extract` (endpoint), `/dscpadmin` (admin sees `risk` aggregate). Run [test.py](../test.py) and `python -m compileall app`.

That is literally the whole recipe.

---

## G. The folder tour

| Folder | What lives here | Edit when |
|---|---|---|
| `app/` | application package | always |
| `app/core/` | cross-cutting config + SSL + Object Store credential resolution | new env var, new infra binding |
| `app/routers/` | HTTP layer | new endpoint or new page |
| `app/services/` | business logic & feature workflows | new feature, new Brain call, refining a workflow |
| `app/services/History/` | persistence and analytics | new history-bearing feature, new metric |
| `app/templates/` | Jinja templates (one per app + base + errors/) | UI structure |
| `app/static/css/` | one stylesheet per feature + `common.css` | look & feel |
| `app/static/js/` | one JS file per feature + `common.js` + vendored libs | client logic |
| `app/static/data/` | `changelog_dev.json`, `changelog_prod.json` | release notes shown in UI |
| `app/static/img/` | logos, illustrations | brand assets |
| `app/static/docs/` | binary templates (e.g. `pptTemplate.potx`) | PPT theme |
| `app/static/signavio_learning/` | embedded learning game assets | learning content |
| `manifest.yml` | CF deployment | infra change |
| `xs-security.json` | XSUAA scopes / role templates | new role |
| `Procfile` | CF buildpack start command | start command change |
| `requirements.txt` | Python deps | new lib |

---

## H. Glossary

| Term | Meaning |
|---|---|
| **DIA Brain** | Bosch's internal LLM-as-a-service platform, accessed under `https://ews-emea.api.bosch.com/.../dia-brain/v1/api`. |
| **Brain ID / knowledgeBaseId** | Identifies a specific configured "brain" (model + RAG + prompt) on the DIA platform. |
| **Workflow ID** | Identifies a multi-step pipeline configured on a brain (used by `call_brain_workflow_chat`). |
| **Chat History ID** | Server-side conversation handle. Returned by `POST /chat-histories/{brain_id}` and reused for follow-up calls so the brain has continuity. |
| **Attachment ID** | ID returned after uploading a file to `POST /chat-attachments`. Reused in subsequent prompts. |
| **XSUAA** | SAP's UAA-based OAuth2 service on BTP. Issues JWTs after corporate-IDP login. |
| **VCAP_SERVICES** | JSON env var injected by Cloud Foundry that contains credentials for every bound service. |
| **gen_id** | UUID4 identifying one user-created generation (a saved PPT, diagram, BPMN, one-pager). |
| **safe_user_id** | Sanitised version of the user's ID used inside S3 object keys. |
| **Best-effort** | Operation tries hard but never raises. Failures are logged and swallowed. Used for analytics + tracking. |
| **Object Store** | BTP's S3-compatible blob storage, bound as `DSCP_APPS_Object_DB`. |
| **Pure-LLM** vs **Workflow** | Two Brain endpoints. Pure-LLM = stateless completion. Workflow = a DIA-configured pipeline (RAG, tools, etc.). |

---

## I. Common tasks cheat-sheet

| Task | Where |
|---|---|
| Add a new Brain feature | new service in `app/services/`, mirror existing pattern |
| Add a new API endpoint | new module under `app/routers/api/` + register in `api/__init__.py` |
| Add a new page | `app/routers/pages.py` + `app/templates/<name>.html` + CSS/JS pair |
| Persist user-generated artifacts | `app/services/History/<feature>_history_service.py` calling `common_history` |
| Add a tracked metric | `analytics_service.py` (track_…) + read in `get_analytics` + render in `admin.js` |
| Add a new env var | `app/core/config.py` *and* document it in `manifest.yml` (placeholder) and [09-deployment.md](09-deployment.md) |
| Add a new Confluence host | `CONFLUENCE_ALLOWED_HOSTS` env var (comma-separated) |
| Deploy | `cf push` (manifest applies). For sensitive vars: `cf set-env dscp-ai BRAIN_CLIENT_SECRET ...; cf restage dscp-ai`. |

---

## J. How to verify things work

* **Health check**: `curl http://localhost:8001/health` → `{"status":"healthy"}`.
* **Page renders**: visit `/` and `/dscpadmin` (when bypass is on, you are auto-admin).
* **Backend smoke**: run [test.py](../test.py).
* **API smoke**: `curl -i http://localhost:8001/api/admin/analytics` (returns 403 unless your user is in `ADMIN_USERS`; with bypass you are `local-dev`, which is admin).
* **Lint / type**: `python -m compileall app`. There is no mypy yet.

---

## K. What to read next

* [03-apps-catalog.md](03-apps-catalog.md) – every app explained.
* [04-auth-and-security.md](04-auth-and-security.md) – XSUAA flow + security baseline.
* [05-data-flow.md](05-data-flow.md) – sequence diagrams for every app.
* [09-deployment.md](09-deployment.md) – when you’re ready to push to BTP.
