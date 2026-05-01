# 02 — Onboarding: Getting Started

This page assumes you have **never seen this repo before**. By the end you will:

* Run the app on your laptop.
* Understand how the code is organised well enough to make a small change.
* Know exactly which file to edit for any given task.

---

## A. Required tools

| Tool | Version | Why |
|---|---|---|
| Python | 3.11+ | The app runs on Python |
| pip / venv | bundled | installs packages into an isolated environment |
| Cloud Foundry CLI (`cf`) | v8 | deploys the app to SAP BTP (only needed for production deploys) |
| Git | any | version control |
| VS Code | recommended | the workspace includes GitHub Copilot instructions |
| Bosch VPN | when calling AI or Confluence | those services are on the corporate network |

You do **not** need Docker, Node.js, a database, or Redis. There is no database and no separate service.

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

`main.py` is just a wrapper. The real app is in `app/main.py`. Running `python main.py` starts Uvicorn (the Python web server) with auto-reload on file changes.

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

> **No Object Store credentials?** The app still starts. History APIs return *Storage unavailable*, analytics counters silently do nothing. This is intentional — persistence is "best-effort" and never blocks the app.

> **No AI (Brain) credentials?** The app still starts. Any AI feature returns a friendly error. This is also intentional.

**How the login bypass works:** Two conditions must both be true:
1. `AUTH_BYPASS_LOCAL=true` is set in `.env`
2. `VCAP_SERVICES` is absent (meaning you are NOT running on Cloud Foundry)

If either condition fails, the real XSUAA login is used. This is a safety gate — you cannot accidentally bypass login on the production server.

When bypassed, you are logged in as `{"user": "local-dev", "email": "local@dev.local"}`. The `local-dev` user is pre-authorised as an admin, so `/dscpadmin` is immediately accessible.

---

## D. Walking the codebase in 5 minutes

Open these files in order. Each is small and focused on one job.

1. [main.py](../main.py) – just calls Uvicorn (the web server). Nothing else here.
2. [app/main.py](../app/main.py) – the real startup file. Reads `.env`, builds the FastAPI app, adds 4 middleware layers (security → size limit → session → auth), registers login/logout routes, and includes the page and API routers.
3. [app/core/config.py](../app/core/config.py) – shared constants, SSL settings, and how to connect to the Object Store.
4. [app/routers/pages.py](../app/routers/pages.py) – every HTML page route. Each route is ≤ 5 lines long.
5. [app/routers/api/](../app/routers/api/) – the JSON API layer. One file per feature, all following the same pattern.
6. [app/services/auth_service.py](../app/services/auth_service.py) – helpers that talk to XSUAA (SAP's login service).
7. [app/services/brain_auth.py](../app/services/brain_auth.py) – gets a Microsoft Azure access token for calling the AI service.
8. [app/services/common_service.py](../app/services/common_service.py) – **the only file that calls DIA Brain.** All AI calls go through here.
9. [app/services/History/storage_service.py](../app/services/History/storage_service.py) – wraps boto3 (the S3/Object Store client) with simple async functions.
10. [app/services/History/common_history.py](../app/services/History/common_history.py) – generic save/load/delete logic for any feature's history.
11. One feature service of your choice, e.g. [app/services/ppt_creator_service.py](../app/services/ppt_creator_service.py).
12. The matching template + JS pair, e.g. [app/templates/ppt_creator.html](../app/templates/ppt_creator.html), [app/static/js/ppt_creator.js](../app/static/js/ppt_creator.js).

If you can describe in one sentence what each file does, you understand the system.

---

## E. The mental model in one paragraph

> Every **page route** does three things: look up who's logged in, record a page-visit counter in the background, render an HTML template. Every **API route** does three things: validate the input data, call a feature service, return JSON (or stream a file). Every **feature service** does two things: call `common_service.py` to talk to the AI, optionally call `History/*` to save results. Every **save** writes a JSON blob to one cloud storage bucket. There is no database, no queue, no background worker. The whole system is flat, async Python — everything is replaceable end-to-end.

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

| Term | Plain-English meaning |
|---|---|
| **DIA Brain** | Bosch's internal AI service. All AI features in the app call this via `https://ews-emea.api.bosch.com/.../dia-brain/v1/api`. |
| **Brain ID** | A unique identifier for a specific "brain" configuration on the DIA platform (a particular model + knowledge base + system prompt). Each app feature has its own Brain ID. |
| **Workflow ID** | Identifies a multi-step AI pipeline configured inside a brain (e.g. analyse → retrieve → generate). |
| **Chat History ID** | A server-side session handle returned by DIA Brain. Reuse it in follow-up calls so the AI remembers the previous conversation context. |
| **Attachment ID** | An ID returned after uploading a file to DIA Brain. Include it in the next prompt so the AI can reference the file. |
| **XSUAA** | SAP's login service on BTP. It uses the standard OAuth 2.0 protocol and verifies users through the corporate identity provider. |
| **OAuth 2.0** | An industry-standard login protocol. The app redirects to XSUAA, the user logs in, and XSUAA returns a short-lived token the app can use. |
| **VCAP_SERVICES** | A JSON environment variable that Cloud Foundry automatically injects, containing credentials (URLs, passwords) for all bound cloud services. Only present when running on CF. |
| **gen_id** | A UUID (universally unique identifier) that identifies one user-created item (a saved PPT, diagram, BPMN, etc.). |
| **safe_user_id** | The user's ID with special characters removed, used in cloud storage paths to keep them safe. |
| **Best-effort** | The operation tries its best but never throws an error if it fails. Failures are logged server-side only. Used for analytics counters and tracking. |
| **Object Store** | BTP's S3-compatible cloud file storage service, bound to the app as `DSCP_APPS_Object_DB`. |
| **Pure-LLM vs Workflow** | Two Brain call types. Pure-LLM = simple prompt/response, no context retrieval. Workflow = a DIA-configured multi-step pipeline (with RAG, tools, etc.). |
| **RAG** | Retrieval-Augmented Generation — the AI retrieves relevant documents from a knowledge base before generating its answer, making answers more accurate. |
| **Uvicorn** | The ASGI web server that runs the FastAPI app. Think of it as the equivalent of Gunicorn for async Python. |
| **Middleware** | Code that runs automatically on every request before reaching the route handler. Like a security checkpoint pipeline. |
| **Pydantic** | A Python library that validates incoming request data (types, lengths, formats) automatically based on a class definition. |
| **Jinja** | The HTML template engine. Python variables can be inserted into `.html` files using `{{ variable }}` syntax. |

---

## I. Common tasks cheat-sheet

| Task | Where |
|---|---|
| Add a new AI feature | Create a new service in `app/services/`, copy the pattern from an existing one |
| Add a new API endpoint | Create a new module under `app/routers/api/` + register it in `api/__init__.py` |
| Add a new page | `app/routers/pages.py` + `app/templates/<name>.html` + CSS/JS pair |
| Save user-generated items | `app/services/History/<feature>_history_service.py` calling `common_history` |
| Add a tracked metric | `analytics_service.py` (add a `track_*` call) + read it in `get_analytics` + show it in `admin.js` |
| Add a new environment variable | `app/core/config.py` *and* document it in `manifest.yml` (as a placeholder) and [09-deployment.md](09-deployment.md) |
| Allow a new Confluence server | Set `CONFLUENCE_ALLOWED_HOSTS` env var (comma-separated hostnames) |
| Deploy to Cloud Foundry | `cf push` (uses settings from `manifest.yml`). For secrets: `cf set-env dscp-ai BRAIN_CLIENT_SECRET ...; cf restage dscp-ai`. |
| Verify the app is running | `curl http://localhost:8001/health` → `{"status":"healthy"}` |

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
