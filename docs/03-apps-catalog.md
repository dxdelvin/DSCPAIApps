# 03 — Apps Catalog

This page documents every app in DSCP_AI: its URL, files, API endpoints, and what it saves.

### What is an "app key"?

Each app has a short code name called an **app key** (e.g. `"ppt"`, `"bpmn"`, `"diagram"`). This key is used everywhere — analytics counters, user history storage paths, the favourites list. The full list is defined in `APP_LABELS` in [analytics_service.py](../app/services/History/analytics_service.py):

```python
APP_LABELS = {
    "ppt":               "PPT Creator",
    "diagram":           "Diagram Generator",
    "bpmn":              "BPMN Builder",
    "audit":             "Audit Check",
    "bpmn-checker":      "BPMN Checker",
    "spec-builder":      "Spec Builder",
    "docupedia":         "Docupedia Publisher",
    "signavio-learning": "Learn Signavio Modeling",
    "one-pager":         "One Pager Creator",
}
```

---

## 1. PPT Creator (`ppt`)

**Purpose**: Convert PDFs / images into a slide-by-slide structured presentation, refine via chat, download as `.pptx`.

| Aspect | Value |
|---|---|
| Page | `/ppt-creator` |
| Template | [app/templates/ppt_creator.html](../app/templates/ppt_creator.html) |
| CSS / JS | `static/css/ppt_creator.css`, `static/js/ppt_creator.js` |
| Service | [app/services/ppt_creator_service.py](../app/services/ppt_creator_service.py) |
| History service | [app/services/History/ppt_history_service.py](../app/services/History/ppt_history_service.py) |
| Brain ID env | `PPT_BRAIN_ID` (and a workflow ID env if used) |
| Storage prefix | `ppt-history/{safe_user_id}/…` |
| Template asset | `static/docs/pptTemplate.potx` |

**Endpoints**

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/ppt/extract` | Upload PDFs / images → AI returns structured slide JSON + chatHistoryId |
| POST | `/api/ppt/refine` | Continue conversation to refine slides |
| POST | `/api/ppt/download` | Build & download `.pptx` from current content |
| GET | `/api/ppt/history` | List user's saved generations |
| GET | `/api/ppt/history/{gen_id}` | Fetch a saved generation |
| POST | `/api/ppt/history` | Persist after first download |
| PUT | `/api/ppt/history/{gen_id}` | Update on subsequent refinements |
| DELETE | `/api/ppt/history/{gen_id}` | Remove |
| POST | `/api/ppt/history/{gen_id}/download` | Re-render `.pptx` from stored JSON |

**Index entry** (the metadata saved in the history list for each item)

```json
{
  "id": "<uuid>",
  "title": "...",
  "subtitle": "...",
  "slideCount": 12,
  "smartArtCount": 2,
  "chatHistoryId": "...",
  "forceOrangeTheme": true,
  "refinements": 1,
  "createdAt": "...",
  "updatedAt": "..."
}
```

**UI rules**: SVG icons only (no emojis). Delete button at top-right of each card. History panel reuses `gen-card`, `history-grid`, `history-panel` classes from `common.css`.

---

## 2. Diagram Generator (`diagram`)

**Purpose**: Analyse PDFs / images, suggest diagram types, generate **draw.io** XML, refine via chat, download `.drawio`.

| Aspect | Value |
|---|---|
| Page | `/diagram-generator` |
| Template | `app/templates/diagram_generator.html` |
| CSS / JS | `diagram_generator.css`, `diagram_generator.js` |
| Service | [app/services/diagram_generator_service.py](../app/services/diagram_generator_service.py) |
| History service | [app/services/History/diagram_history_service.py](../app/services/History/diagram_history_service.py) |
| Storage prefix | `diagram-history/{safe_user_id}/…` |

**Endpoints**

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/diagram/analyze` | Files in → analysis + extractedText |
| POST | `/api/diagram/generate` | analysis + extractedText → list of draw.io diagrams |
| POST | `/api/diagram/refine` | Refine one diagram |
| POST | `/api/diagram/copy-image` | "Copy as Diagram" mode (1 image only) |
| POST | `/api/diagram/download` | Wrap diagrams as `.drawio` |
| GET / POST / PUT / DELETE / POST `…/download` | `/api/diagram/history*` | Same shape as PPT |

UI must mirror the **mode tabs** (`dg-tab-nav`, `dg-tab-btn`) baseline shared with PPT.

---

## 3. BPMN Builder (`bpmn`)

**Purpose**: Generate Signavio-compatible BPMN 2.0 XML (a standard process diagram format) from either form input ("Form Builder" mode) or an uploaded diagram/PDF ("Upload & Build" mode), with chat refinement.

> **BPMN** = Business Process Model and Notation — the international standard for process diagrams. Signavio is the process modelling tool used at Bosch.

| Aspect | Value |
|---|---|
| Page | `/signavio-bpmn` |
| Template | `app/templates/signavio_bpmn.html` |
| CSS / JS | `signavio_bpmn.css`, `signavio_bpmn.js` |
| Service | [app/services/signavio_service.py](../app/services/signavio_service.py) |
| History service | [app/services/History/bpmn_history_service.py](../app/services/History/bpmn_history_service.py) |
| Workflow ID | `SIGNAVIO_WORKFLOW_ID` (default `BW10nzxLhlqO`) |
| Storage prefix | `bpmn-history/{safe_user_id}/…` |

**Endpoints**

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/bpmn/start-session` | Create chat history + initial process analysis |
| POST | `/api/bpmn/chat` | Continue analysis chat |
| POST | `/api/bpmn/upload-analyze` | Analyse uploaded BPMN/PDF/image. Returns `[DOCUMENT_VALID]` / `[DOCUMENT_INVALID]` tag |
| POST | `/api/generate-bpmn` | Produce final BPMN XML |
| POST | `/api/make-bpmn-analysis` | **Legacy** endpoint (kept for back-compat) |
| GET / POST / PUT / DELETE / POST `…/download` | `/api/bpmn/history*` | Save / load / replay XML |

The `[DOCUMENT_VALID]` / `[DOCUMENT_INVALID]` tag on the **first line** of the upload analysis response is a contract between the AI prompt and the JavaScript. The JS checks this tag to decide whether to continue. Do not break this convention.

---

## 4. BPMN Checker (`bpmn-checker`)

**Purpose**: Audit a BPMN diagram (PDF or image) for errors, best-practice issues and logical flow problems. **No history**.

| Aspect | Value |
|---|---|
| Page | `/bpmn-checker` |
| Service | [app/services/bpmn_checker_service.py](../app/services/bpmn_checker_service.py) |
| Brain ID env | `BPMN_CHECKER_BRAIN_ID` |
| Endpoint | `POST /api/bpmn-diagram-check` (multipart `file`, optional `context`) |

The service tries to JSON-parse the result; on failure returns the raw text under `analysis` and `analysisStructured` is null.

---

## 5. Audit Check (`audit`)

**Purpose**: Audit a PDF document against an internal policy brain, then continue a Q&A chat (with optional file attachment per turn).

| Aspect | Value |
|---|---|
| Page | `/audit-check` |
| Service | [app/services/audit_service.py](../app/services/audit_service.py) |
| Brain ID env | `AUDIT_CHECK_BRAIN_ID` |

**Endpoints**

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/audit-doc-check` | Upload PDF, get initial analysis + chatHistoryId |
| POST | `/api/audit-chat` | multipart: chatHistoryId + message + optional file |

No history persistence — interactive only.

---

## 6. Spec Builder (`spec-builder`)

**Purpose**: Generate three flavours of `.docx` from form data — Functional Spec, Business Requirement, FS Variant. **No Brain calls**, no history. Pure document generation.

| Aspect | Value |
|---|---|
| Page | `/spec-builder` |
| Template | `app/templates/fs_br_document.html` |
| CSS / JS | `fs_br_document.css`, `fs_br_document.js` |
| Service | [app/services/fs_br_document_service.py](../app/services/fs_br_document_service.py) |

**Endpoints** (each accepts a large Pydantic body and streams `.docx`):

* `POST /api/export-functional-spec`
* `POST /api/export-business-requirement`
* `POST /api/export-fs-variant`

Each calls `track_generation("spec-builder")` + `track_download("spec-builder")`.

---

## 7. Docupedia Publisher (`docupedia`)

**Purpose**: Take uploaded files, ask the AI to draft a **Confluence storage-format** page, refine it via chat, then publish to Bosch Docupedia (Confluence) using a user-supplied **Personal Access Token (PAT)**.

> **Confluence storage format**: Confluence's internal XML-based page format. The AI generates this XML directly, which can then be published via the Confluence REST API.
>
> **PAT (Personal Access Token)**: A password-like token the user generates in Confluence. The app uses it to publish on the user's behalf. The token is **never logged or saved** by the app.

| Aspect | Value |
|---|---|
| Page | `/docupedia-publisher` |
| Service | [app/services/confluence_builder_service.py](../app/services/confluence_builder_service.py) |
| Default Confluence URL | `https://inside-docupedia.bosch.com/confluence2` |
| SSRF allowlist env | `CONFLUENCE_ALLOWED_HOSTS` (default `inside-docupedia.bosch.com`) |

**Endpoints**

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/confluence-builder/verify-connection` | Validate PAT + space + parent page |
| POST | `/api/confluence-builder/generate` | multipart: files + manifest → JSON `{title,summary,storageXml,warnings}` |
| POST | `/api/confluence-builder/refine` | refine the draft via chat |
| POST | `/api/confluence-builder/publish` | publish + upload attachments to Confluence |

The **PAT is never logged or persisted**. URL must pass `_validate_confluence_url` (HTTPS + host allowlist).

---

## 8. One Pager Creator (`one-pager`)

**Purpose**: Generate a single-page **HTML** document (executive summary / cheatsheet / flyer / infographic) from inputs + optional uploads, refine via chat, store as HTML.

| Aspect | Value |
|---|---|
| Page | `/one-pager-creator` |
| Service | [app/services/one_pager_creator_service.py](../app/services/one_pager_creator_service.py) |
| History service | [app/services/History/one_pager_history_service.py](../app/services/History/one_pager_history_service.py) |
| Storage prefix | `one-pager-history/{safe_user_id}/…` |
| Allowed styles | `cheatsheet`, `flyer`, `executive_summary`, `infographic` (+ project_brief / status_update / technical_overview / business_case for history saves) |
| Allowed orientations | `portrait`, `landscape` |

**Endpoints**

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/one-pager/extract` | files + topic context → HTML |
| POST | `/api/one-pager/refine` | message → HTML |
| GET / POST / PUT / DELETE | `/api/one-pager/history*` | persistence |

The history schema stores `title`, `html`, `templateStyle`, `orientation`, `chatHistoryId`.

---

## 9. Signavio Learning (`signavio-learning`)

**Purpose**: External learning experience hosted on internal GitHub Pages.

| Aspect | Value |
|---|---|
| Page | `/signavio-learning` (302 redirect) |
| Target | `https://pages.github-bshg.boschdevcloud.com/DSD9DI/SignavioModelling/index.html` |

Static assets (games + images) ship in `app/static/signavio_learning/` for completeness, but the live page is offsite. Click is still tracked through `track_click("signavio-learning", user_id)`.

---

## 10. Admin dashboard

**Purpose**: Aggregate all analytics & feedback. Restricted to users in `ADMIN_USERS`.

| Aspect | Value |
|---|---|
| Page | `/dscpadmin` |
| Template | [app/templates/admin.html](../app/templates/admin.html) |
| CSS / JS | `admin.css`, `admin.js` |
| Admin users | `frozenset({"dsd9di", "local-dev", "eim1di", "bsr1di"})` |
| Endpoints | `GET /api/admin/analytics?days=N`, `GET /api/admin/feedback` |

**`/api/admin/analytics` payload** (parameter `days` in `[7,365]`, default 28):

```json
{
  "daily_clicks":       {"YYYY-MM-DD": {"ppt": int, ...}},
  "daily_unique_users": {"YYYY-MM-DD": {"ppt": ["uid", ...]}},
  "users_total":        {"ppt": ["uid", ...]},
  "daily_generations":  {"YYYY-MM-DD": {"ppt": int}},
  "daily_gen_failed":   {"YYYY-MM-DD": {"ppt": int}},
  "daily_downloads":    {"YYYY-MM-DD": {"ppt": int}},
  "generations":        {"ppt": int_all_time},
  "gen_failed_total":   {"ppt": int_all_time},
  "downloads":          {"ppt": int_all_time},
  "app_labels":         { ... },
  "date_range":         ["YYYY-MM-DD", ...]
}
```

**`/api/admin/feedback` payload**:

```json
{
  "aggregates": {
    "ppt": {"total_count": 12, "score_sum": 38, "scores": {"1": 1, "2": 2, "3": 3, "4": 6}, "last_updated": "..."},
    "...": "..."
  },
  "app_labels": { ... }
}
```

The frontend uses canvas-based stacked bar charts, dark-mode aware. See [08-frontend-guide.md](08-frontend-guide.md).

---

## Cross-cutting features

### User Favourites
* Persist starred app keys per user.
* `GET /api/favorites`, `POST /api/favorites/{app_key}`, `DELETE /api/favorites/{app_key}`.
* Allowed keys: `ALLOWED_APP_KEYS` in [favorites_service.py](../app/services/History/favorites_service.py).

### Feedback / Reactions
* `POST /api/feedback/{app_key}` body `{gen_id?, rating: 1..4}` writes one record to `feedback/{app_key}/{uuid}.json` and updates `feedback/aggregate/{app_key}.json`.
* Lazy 5-year retention cleanup (one expired record removed per submission).

### Personal stats
* `GET /api/user/stats` returns the authenticated user's history sizes for PPT / Diagram / One Pager.

### Client logging
* `POST /api/client-log` accepts `{level, message, metadata, path, userAgent, ts}`.
* Server sanitises control characters and only accepts `{debug, info, warn, warning, error}`.

### Health
* `GET /health` → `{"status":"healthy"}` — used by Cloud Foundry.

---

## App-by-app failure modes

What happens to each app when the AI service is down, or when cloud storage is unavailable:

| App | If AI (Brain) is unavailable | If storage is unavailable |
|---|---|---|
| PPT Creator | Returns 500 with a friendly message; failure is counted | History endpoints return 503; generation still works in-session |
| Diagram Generator | Returns 500/502/503/504 (mapped from AI error); failure counted | History returns 503 |
| BPMN Builder | Returns 500; failure not counted for the XML generation step | History returns 503 |
| BPMN Checker | Returns 500; no history affected | Not applicable (no history) |
| Audit Check | Returns 500 | Not applicable (no history) |
| Spec Builder | Not applicable (no AI calls) | Not applicable (no history) |
| Docupedia Publisher | Returns 500 with mapped status; PAT errors return specific messages | Not applicable |
| One Pager Creator | Returns 500/502/503/504; failure counted | History returns 503 |
