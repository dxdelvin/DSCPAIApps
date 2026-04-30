# DSCP_AI — Documentation

BSH **Digital Supply Chain Planning – AI Apps Suite**.
A FastAPI + Jinja2 monolith hosted on **SAP BTP Cloud Foundry** that ships **9 AI-powered productivity apps** wired to the corporate **DIA Brain** LLM platform, secured behind **XSUAA** OAuth2, and persisted in a **BTP Object Store** (S3‑compatible).

> If you read **only one page**, read [02-onboarding.md](02-onboarding.md). It’s built for a brand‑new developer.

---

## Documentation map

| # | File | What's inside |
|---|------|---------------|
| 00 | [README.md](README.md) | This index |
| 01 | [01-architecture.md](01-architecture.md) | The "ULTRA PLAN" — system-wide architecture, layers, request lifecycle, technology choices |
| 02 | [02-onboarding.md](02-onboarding.md) | A→Z developer onboarding: clone, env, run, test, deploy. Mental model. Glossary. |
| 03 | [03-apps-catalog.md](03-apps-catalog.md) | Every app explained: PPT Creator, Diagram Generator, BPMN Builder, BPMN Checker, Audit Check, Spec Builder, Docupedia Publisher, One Pager Creator, Signavio Learning, Admin |
| 04 | [04-auth-and-security.md](04-auth-and-security.md) | XSUAA OAuth2 flow, session model, security middleware, OWASP-Top-10 hardening, role templates |
| 05 | [05-data-flow.md](05-data-flow.md) | User-flow + data-flow + sequence diagrams (Mermaid) for each app |
| 06 | [06-storage-and-history.md](06-storage-and-history.md) | Object Store layout, history CRUD, analytics keys, retention, gen_id model |
| 07 | [07-api-reference.md](07-api-reference.md) | Every HTTP endpoint: method, payload, response, error codes |
| 08 | [08-frontend-guide.md](08-frontend-guide.md) | Templates, CSS variables, JS modules, design tokens, dark mode, toast, helpers |
| 09 | [09-deployment.md](09-deployment.md) | BTP / CF deployment, manifest, environment variables, role provisioning, troubleshooting |
| 10 | [10-adding-a-new-app.md](10-adding-a-new-app.md) | Step-by-step guide to adding a brand-new app: the 9-file checklist, Brain wiring, history service, frontend conventions, security rules |

---

## 30-second elevator pitch

```
                                            ┌────────────────────────┐
   Browser ──HTTPS──▶  CF Router  ──▶  FastAPI  ──▶  DIA Brain (LLM) │
                                       │   │
                                       │   └──▶  BTP Object Store (S3)
                                       │
                                       └──▶  XSUAA (OAuth2 / JWT)
```

* **9 apps** live behind one FastAPI process (`app.main:app`).
* Every page route is **gated by XSUAA** through `AuthMiddleware`.
* Every AI feature talks to **DIA Brain** via a small set of helpers in `app/services/common_service.py`.
* Per-user **history** + global **analytics** persist as JSON blobs in the BTP Object Store.
* The frontend is **server-rendered Jinja** + **vanilla JS** (no SPA framework).

---

## File-tree at a glance

```
DSCP_AI/
├── main.py                         # local-dev entry (uvicorn → app.main:app)
├── manifest.yml                    # CF deployment descriptor
├── xs-security.json                # XSUAA scopes & role templates
├── Procfile                        # CF buildpack start command
├── requirements.txt
├── README.md                       # repo-level quickstart
├── docs/                           # ← you are here
└── app/
    ├── main.py                     # FastAPI app + middleware stack + OAuth routes
    ├── core/config.py              # env + SSL + Object Store credentials
    ├── routers/
    │   ├── pages.py                # HTML pages (Jinja)
    │   └── api.py                  # JSON / file APIs (/api/*)
    ├── services/
    │   ├── auth_service.py         # XSUAA helpers (login, callback, validate)
    │   ├── brain_auth.py           # Microsoft → DIA Brain token (client_credentials)
    │   ├── common_service.py       # Brain helpers: chat history, attachments, workflow / pure-LLM
    │   ├── signavio_service.py     # BPMN Builder feature
    │   ├── audit_service.py        # Audit Check feature
    │   ├── bpmn_checker_service.py # BPMN Checker feature
    │   ├── ppt_creator_service.py  # PPT Creator feature
    │   ├── diagram_generator_service.py
    │   ├── one_pager_creator_service.py
    │   ├── confluence_builder_service.py
    │   ├── fs_br_document_service.py # Spec Builder (.docx exports)
    │   └── History/
    │       ├── storage_service.py  # boto3 S3 client wrapper (async)
    │       ├── common_history.py   # generic CRUD over Object Store
    │       ├── analytics_service.py# clicks / generations / users / downloads
    │       ├── feedback_service.py # rating reactions
    │       ├── favorites_service.py# user favourites
    │       ├── user_id_utils.py    # safe_user_id sanitiser
    │       ├── ppt_history_service.py
    │       ├── diagram_history_service.py
    │       ├── bpmn_history_service.py
    │       └── one_pager_history_service.py
    ├── static/  # css/, js/, img/, data/, docs/, signavio_learning/
    └── templates/                  # base.html + 1 template per app + errors/
```

---

## Conventions you must respect

1. **Brain calls** go through `app/services/common_service.py`. Never call the Brain HTTP endpoint directly from a router.
2. **Outgoing HTTPS** must use `verify=get_ssl_context()` from `app/core/config.py`. Never `verify=False`.
3. **File uploads** must validate **magic bytes** (`_validate_magic`) and respect a 10 MB cap.
4. **gen_id** is UUID4, validated at the API boundary by `_validate_gen_id`.
5. **Auth bypass** locally needs **both** `AUTH_BYPASS_LOCAL=true` **and** the absence of `VCAP_SERVICES`.
6. **History saves** call `track_generation(app_key)` — that one line keeps the admin dashboard accurate.
7. **No emojis** in PPT-creator UI; SVG icons only.
8. **CSS / JS** — prefer existing helpers in [app/static/css/common.css](../app/static/css/common.css) and [app/static/js/common.js](../app/static/js/common.js) before adding feature-specific code.

See each topic page for the deep dive.
