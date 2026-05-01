# 07 — API Reference

This page lists every HTTP route the app exposes.

**Three groups of routes:**
* **OAuth / system** — login, logout, health check (defined in [app/main.py](../app/main.py))
* **HTML pages** — return browser pages (defined in [app/routers/pages.py](../app/routers/pages.py))
* **JSON / file APIs** (`/api/*`) — return JSON data or stream files (defined in [app/routers/api/](../app/routers/api/))

> **Auth:** Every route requires login unless listed in §1.1. All `/api/*` errors return JSON `{"status": "error", "message": "..."}` — internal exception details are never exposed.

> **Pydantic models** = Python classes used to validate request data. `max_length=200` means the field cannot be longer than 200 characters. This prevents oversized inputs from reaching the AI or storage.

### API module layout

Each feature has its own module under `app/routers/api/`. New features should follow this same pattern and be registered in `api/__init__.py`.

| Module | Endpoints |
|---|---|
| [`_shared.py`](../app/routers/api/_shared.py) | Shared helpers used by all modules (logger, size limits, file type validators, UUID validator) |
| [`client_log.py`](../app/routers/api/client_log.py) | `POST /client-log` |
| [`bpmn.py`](../app/routers/api/bpmn.py) | BPMN Builder endpoints + history |
| [`audit.py`](../app/routers/api/audit.py) | Audit Check endpoints |
| [`bpmn_checker.py`](../app/routers/api/bpmn_checker.py) | BPMN Checker endpoint |
| [`spec_builder.py`](../app/routers/api/spec_builder.py) | Spec Builder document export endpoints |
| [`ppt.py`](../app/routers/api/ppt.py) | PPT Creator endpoints + history |
| [`diagram.py`](../app/routers/api/diagram.py) | Diagram Generator endpoints + history |
| [`confluence.py`](../app/routers/api/confluence.py) | Docupedia Publisher endpoints |
| [`one_pager.py`](../app/routers/api/one_pager.py) | One Pager Creator endpoints + history |
| [`favorites.py`](../app/routers/api/favorites.py) | Favourites management |
| [`admin.py`](../app/routers/api/admin.py) | Admin analytics + user stats |
| [`feedback.py`](../app/routers/api/feedback.py) | User ratings/feedback |

> When adding a new app, create a new module here and register it in `__init__.py`. See [10-adding-a-new-app.md](10-adding-a-new-app.md).

---

## 1. System & OAuth

### 1.1 Public paths (no login required)

```
/login, /auth/callback, /logout  — OAuth2 login flow
/static/*                        — CSS, JS, images (no secrets here)
/health                          — SAP BTP health probe (must be public)
/api/client-log                  — browser error logging (no user data)
```

### 1.2 Auth flow

| Method | Path | Function | Notes |
|---|---|---|---|
| `GET` | `/login` | `login(request)` | Builds XSUAA `authorize` URL with CSRF `state` (32-byte URL-safe), redirects. Local dev (no `VCAP_SERVICES`) → `/`. |
| `GET` | `/auth/callback` | `auth_callback(request, code, error, state)` | Validates `state` with `secrets.compare_digest`, exchanges code at XSUAA `/oauth/token`, calls `validate_token`, stores `user_info` in session. |
| `GET` | `/logout` | `logout(request)` | `request.session.clear()`, redirects to XSUAA logout URL (or `/` locally). |

### 1.3 Health

| Method | Path | Response | Auth |
|---|---|---|---|
| `GET` | `/health` | `{"status": "healthy"}` | Public — used by CF liveness. |

### 1.4 Client logging

| Method | Path | Body | Auth |
|---|---|---|---|
| `POST` | `/api/client-log` | `ClientLogRequest` | **Public**. Strips control chars, validates level ∈ `{debug, info, warning, error}`. |

```py
class ClientLogRequest(BaseModel):
    level:     str = "error"   # max_length=20
    message:   str             # max_length=5000
    metadata:  Optional[str]   # max_length=10000
    path:      Optional[str]   # max_length=500
    userAgent: Optional[str]   # max_length=500
    ts:        Optional[str]   # max_length=50
```

---

## 2. Page routes (HTML)

All page handlers do exactly three things:

1. Look up the currently logged-in user (`get_current_user(request)`)
2. Start a page-visit counter in the background ("fire-and-forget" — doesn't slow the page load)
3. Return a rendered HTML template
2. `asyncio.create_task(track_click(app_key, user_info["user"]))`
3. Return `_render_template(template, request, **ctx)`

| Method | Path | Template | `app_key` (for `track_click`) |
|---|---|---|---|
| `GET` | `/` | `index.html` | — (no track_click, homepage) |
| `GET` | `/signavio-bpmn` | `signavio_bpmn.html` | `bpmn` |
| `GET` | `/audit-check` | `audit_check.html` | `audit` |
| `GET` | `/bpmn-checker` | `bpmn_checker.html` | `bpmn-checker` |
| `GET` | `/spec-builder` | `fs_br_document.html` | `spec-builder` |
| `GET` | `/ppt-creator` | `ppt_creator.html` | `ppt` |
| `GET` | `/diagram-generator` | `diagram_generator.html` | `diagram` |
| `GET` | `/docupedia-publisher` | `docupedia_publisher.html` | `docupedia` |
| `GET` | `/one-pager-creator` | `one_pager_creator.html` | `one-pager` |
| `GET` | `/signavio-learning` | — (302 redirect) | `signavio-learning` |
| `GET` | `/dscpadmin` | `admin.html` or `errors/403.html` | — (admin gate via `ADMIN_USERS`) |

Every template gets `css_version` (cache-bust) and `app_env`, `client_log_level`, `changelog`, `brain_portal_url` plumbed by `_render_template`.

---

## 3. BPMN Builder API

| Method | Path | Body / Form | Response | Brain ID |
|---|---|---|---|---|
| `POST` | `/api/bpmn/start-session` | `BPMNSessionRequest` | `{status, chatHistoryId, analysis}` | `SIGNAVIO_BRAIN_ID` |
| `POST` | `/api/bpmn/chat` | `BPMNChatRequest` | `{status, chatHistoryId, response}` | `SIGNAVIO_BRAIN_ID` |
| `POST` | `/api/bpmn/upload-analyze` | `file` (PDF/PNG/JPG ≤ 10 MB) | `{status, analysis, chatHistoryId, document_valid}` | `SIGNAVIO_BRAIN_ID` |
| `POST` | `/api/generate-bpmn` | `BPMNGenerateRequest` | `{status, xml, filename}` | `SIGNAVIO_BRAIN_ID` |
| `POST` | `/api/make-bpmn-analysis` | dict (legacy) | `{status, analysis, chatHistoryId}` | (legacy) |

```py
class BPMNSessionRequest(BaseModel):
    processName:        str = ""   # max_length=200
    poolName:           str = ""   # max_length=200
    participants:       str = ""   # max_length=500
    subLanes:           str = ""   # max_length=500
    startTriggers:      str = ""   # max_length=2000
    processActivities:  str = ""   # max_length=5000
    processEnding:      str = ""   # max_length=2000
    intermediateEvents: str = ""   # max_length=2000
    reviewOverride:     str = ""   # max_length=3000

class BPMNChatRequest(BaseModel):
    chatHistoryId: str            # max_length=200
    message:       str            # max_length=5000
    formData:      Optional[dict] # serialized JSON ≤ 50 KB
```

`BPMNGenerateRequest` is `BPMNSessionRequest` + optional `chatHistoryId`.

### 3.1 BPMN history (per-user)

| Method | Path | Behavior |
|---|---|---|
| `GET` | `/api/bpmn/history` | List user generations (newest first). |
| `GET` | `/api/bpmn/history/{gen_id}` | Fetch full content blob. |
| `POST` | `/api/bpmn/history` | Save new — `BpmnHistorySaveRequest` (`content: dict`). Returns `{genId}`. |
| `PUT` | `/api/bpmn/history/{gen_id}` | Update existing. |
| `DELETE` | `/api/bpmn/history/{gen_id}` | Delete content + index entry. |
| `POST` | `/api/bpmn/history/{gen_id}/download` | Stream stored BPMN XML; `track_download("bpmn")`. |

`gen_id` is regex-validated UUID4 → **422** on malformed.

---

## 4. Audit Check API

| Method | Path | Form | Response | Brain ID |
|---|---|---|---|---|
| `POST` | `/api/audit-doc-check` | `file` (PDF only ≤ 10 MB) | `{status, analysis, chatHistoryId}` | `AUDIT_CHECK_BRAIN_ID` |
| `POST` | `/api/audit-chat` | `chatHistoryId` (≤200), `message` (≤5000), optional `file` (PDF) | `{status, response, chatHistoryId}` | `AUDIT_CHECK_BRAIN_ID` |

No history persistence.

---

## 5. BPMN Checker API

| Method | Path | Form | Response | Brain ID |
|---|---|---|---|---|
| `POST` | `/api/bpmn-diagram-check` | `file` (PDF/PNG/JPG ≤ 10 MB), `context` (optional str) | `{status, analysis, analysisStructured, chatHistoryId}` | `BPMN_CHECKER_BRAIN_ID` |

Service attempts JSON parse of `result`; falls back to text. No history persistence.

---

## 6. Spec Builder (FS / BR documents)

All three endpoints stream a `.docx` file (`StreamingResponse`, `Content-Disposition: attachment`). All call `track_generation("spec-builder")` + `track_download("spec-builder")`. No Brain calls — pure `python-docx`.

| Method | Path | Body model |
|---|---|---|
| `POST` | `/api/export-functional-spec` | `FSExportRequest` |
| `POST` | `/api/export-business-requirement` | `BRExportRequest` |
| `POST` | `/api/export-fs-variant` | `FSVariantExportRequest` |

```py
class FSExportRequest(BaseModel):
    title:               str   # ≤200
    date:                str   # ≤50
    version:             str   # ≤50
    author:              str   # ≤200
    responsibilities:    dict  # default {}
    projectGoal:         str   # ≤10000
    solutionDesc:        str   # ≤10000
    improvementPotential:str   # ≤10000
    delimitation:        str   # ≤10000
    functionality:       str   # ≤10000
    userView:            str   # ≤10000
    languageTopics:      str   # ≤10000
    dataStructures:      str   # ≤10000
    dataMaintenance:     str   # ≤10000
    interfaces:          str   # ≤10000
    authorization:       str   # ≤10000
    infoSecurity:        str   # ≤10000
    architecture:        str   # ≤10000
    risks:               str   # ≤10000
    openIssues:          str   # ≤10000
    migration:           str   # ≤10000
    previousSteps:       list  # default []
    report:              str   # ≤200
    transaction:         str   # ≤200
    sourceSystem:        str   # ≤200
    glossary:            list  # default []
    docHistory:          list  # default []
```

`BRExportRequest` covers project + product owner + signoff/decision/cost dicts. `FSVariantExportRequest` is the long-form variant of FS with extensive ≤5000-char text sections.

---

## 7. PPT Creator API

| Method | Path | Body / Form | Response | Brain ID |
|---|---|---|---|---|
| `POST` | `/api/ppt/extract` | files (PDF/PNG/JPG, ≤10 MB total, ≤3 images), `username`, `instructions?`, `force_orange_theme: bool` | `{status, content, chatHistoryId}` | `PPT_BRAIN_ID` |
| `POST` | `/api/ppt/refine` | `PptRefineRequest` | `{status, content, chatHistoryId, response}` | `PPT_BRAIN_ID` |
| `POST` | `/api/ppt/download` | `PptDownloadRequest` | StreamingResponse (`.pptx`) | — (`python-pptx`) |

```py
class PptRefineRequest(BaseModel):
    chatHistoryId:    str           # ≤200
    message:          str           # ≤5000
    currentContent:   Optional[dict]
    forceOrangeTheme: bool

class PptDownloadRequest(BaseModel):
    content:          dict
    username:         str = "Unknown User"
    forceOrangeTheme: bool
```

### 7.1 PPT history

| Method | Path |
|---|---|
| `GET` | `/api/ppt/history` |
| `GET` | `/api/ppt/history/{gen_id}` |
| `POST` | `/api/ppt/history` (`PptHistorySaveRequest`) |
| `PUT` | `/api/ppt/history/{gen_id}` |
| `DELETE` | `/api/ppt/history/{gen_id}` |
| `POST` | `/api/ppt/history/{gen_id}/download` (`PptHistoryDownloadRequest`) |

```py
class PptHistorySaveRequest(BaseModel):
    content:          dict
    chatHistoryId:    str   # ≤200
    forceOrangeTheme: bool

class PptHistoryDownloadRequest(BaseModel):
    forceOrangeTheme: bool
    username:         str   # ≤200
```

---

## 8. Diagram Generator API

| Method | Path | Body / Form | Response | Brain ID |
|---|---|---|---|---|
| `POST` | `/api/diagram/analyze` | files (PDF/PNG/JPG, ≤10 MB total), `instructions?` | `{status, analysis, chatHistoryId, extractedText}` | `DIAGRAM_BRAIN_ID` |
| `POST` | `/api/diagram/generate` | `DiagramGenerateRequest` | `{status, diagrams, chatHistoryId}` | `DIAGRAM_BRAIN_ID` |
| `POST` | `/api/diagram/refine` | `DiagramRefineRequest` | `{status, xml, chatHistoryId}` | `DIAGRAM_BRAIN_ID` |
| `POST` | `/api/diagram/copy-image` | exactly 1 image (PNG/JPG, ≤10 MB) | `{status, diagrams, chatHistoryId}` or `{status: "not_a_diagram", suggestion, …}` | `DIAGRAM_BRAIN_ID` |
| `POST` | `/api/diagram/download` | `DiagramDownloadRequest` | `.drawio` file | — |

```py
class DiagramGenerateRequest(BaseModel):
    chatHistoryId:   str           # ≤200
    analysis:        dict
    extractedText:   str           # ≤50000
    selectedIndices: Optional[list[int]]

class DiagramRefineRequest(BaseModel):
    chatHistoryId: str   # ≤200
    message:       str   # ≤5000
    currentXml:    str   # ≤50000
    diagramName:   str   # ≤200

class DiagramDownloadRequest(BaseModel):
    diagrams: list
```

`copy-image` maps Brain errors to HTTP **400/500/502/503/504** based on the upstream error.

### 8.1 Diagram history

| Method | Path |
|---|---|
| `GET` | `/api/diagram/history` |
| `GET` | `/api/diagram/history/{gen_id}` |
| `POST` | `/api/diagram/history` (`DiagramHistorySaveRequest = {content, chatHistoryId}`) |
| `PUT` | `/api/diagram/history/{gen_id}` |
| `DELETE` | `/api/diagram/history/{gen_id}` |
| `POST` | `/api/diagram/history/{gen_id}/download` |

---

## 9. One Pager Creator API

| Method | Path | Body / Form | Response | Brain ID |
|---|---|---|---|---|
| `POST` | `/api/one-pager/extract` | files (PDF/PNG/JPG ≤10 MB total), `topic`, `keyPoints`, `audience`, `purpose`, `templateStyle="executive_summary"`, `orientation` | `{status, html, chatHistoryId}` | `ONE_PAGER_BRAIN_ID` |
| `POST` | `/api/one-pager/refine` | `OnePagerRefineRequest` | `{status, html, chatHistoryId}` | `ONE_PAGER_BRAIN_ID` |

```py
class OnePagerRefineRequest(BaseModel):
    chatHistoryId: str   # ≤200
    message:       str   # ≤5000
    currentHtml:   str   # ≤200000
    templateStyle: str   # ≤50
    orientation:   str   # ≤20
```

### 9.1 One Pager history (cap 30)

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/one-pager/history` | |
| `GET` | `/api/one-pager/history/{gen_id}` | |
| `POST` | `/api/one-pager/history` | `OnePagerHistorySaveRequest` |
| `PUT` | `/api/one-pager/history/{gen_id}` | `OnePagerHistoryUpdateRequest` |
| `DELETE` | `/api/one-pager/history/{gen_id}` | |

```py
class OnePagerHistorySaveRequest(BaseModel):
    title:         str = "Untitled"   # ≤300
    html:          str                # ≤500000
    templateStyle: str                # ≤50
    orientation:   str                # ≤20
    chatHistoryId: str                # ≤200

class OnePagerHistoryUpdateRequest(BaseModel):
    html:          str                # ≤500000
    chatHistoryId: str                # ≤200
    title:         Optional[str]      # ≤300
```

---

## 10. Docupedia Publisher (Confluence)

| Method | Path | Body | Notes |
|---|---|---|---|
| `POST` | `/api/confluence-builder/verify-connection` | `ConfluenceVerifyRequest` | Validates URL via `_validate_confluence_url` (HTTPS + host allowlist), tests PAT against Confluence REST API. |
| `POST` | `/api/confluence-builder/generate` | files + `uploadManifest` (req.) + `requestedTitle?` + `instructions?` | Calls `DOCUPEDIA_BRAIN_ID` via `pure-llm` chat. |
| `POST` | `/api/confluence-builder/refine` | `ConfluenceRefineRequest` | |
| `POST` | `/api/confluence-builder/publish` | form: `uploadManifest`, `draft`, `confluenceUrl`, `pat`, `spaceKey`, `parentPageId`, optional files | SSRF check → create page → upload attachments. Returns `{page_id, page_url}`. |

```py
class ConfluenceVerifyRequest(BaseModel):
    confluenceUrl: str   # ≤500
    pat:           str   # ≤500
    spaceKey:      str   # ≤200
    parentPageId:  str   # ≤200

class ConfluenceDraftPayload(BaseModel):
    storageXml:           str   # ≤50000
    attachmentReferences: list[dict] = []
    displayImages:        list[dict] = []
    warnings:             list[str]  = []

class ConfluenceRefineRequest(BaseModel):
    chatHistoryId: str                       # ≤200
    instruction:   str                       # ≤5000
    draft:         ConfluenceDraftPayload
```

**SSRF**: `_validate_confluence_url(url)` enforces `https://` and hostname ∈ `CONFLUENCE_ALLOWED_HOSTS` (default `inside-docupedia.bosch.com`).

No history persistence.

---

## 11. Favorites API

| Method | Path | Behavior |
|---|---|---|
| `GET` | `/api/favorites` | `{favorites: list[str]}` |
| `POST` | `/api/favorites/{app_key}` | Add. `app_key` must be in `ALLOWED_APP_KEYS` else **400**. |
| `DELETE` | `/api/favorites/{app_key}` | Remove. |

---

## 12. Feedback API

| Method | Path | Body / Auth |
|---|---|---|
| `POST` | `/api/feedback/{app_key}` | `FeedbackRequest = {gen_id?: str(≤200), rating: int 1..4}`. `app_key` validated against `APP_LABELS`. |
| `GET` | `/api/admin/feedback` | **Admin-only**. Returns `{aggregates, app_labels}`. |

---

## 13. Admin analytics

| Method | Path | Query | Auth |
|---|---|---|---|
| `GET` | `/api/admin/analytics` | `days: int = 28` (range `7..365`) | Admin (`ADMIN_USERS`) |

Returns the full structure documented in [06-storage-and-history.md §5.4](06-storage-and-history.md#54-await-get_analyticsdays28--dict).

---

## 14. User stats

| Method | Path | Response |
|---|---|---|
| `GET` | `/api/user/stats` | `{ppt: int, diagram: int, one_pager: int, total: int}` — counts entries in the user's history index files. |

---

## 15. Validation & limits

| Concern | Rule |
|---|---|
| Request body size | Hard cap of 15 MB. Requests over this are rejected before login check. |
| Upload size | Max 10 MB per file. Max 10 MB total across all files in one request. |
| File type | Checked by **magic bytes** (first few bytes of the file), not by filename or Content-Type header. Accepted: PDF (`%PDF-`), PNG (`\x89PNG\r\n`), JPEG (`\xff\xd8\xff`). |
| `gen_id` (history IDs) | Must match UUID v4 format (e.g. `a1b2c3d4-...`). Invalid values return HTTP 422. |
| Text fields | All Pydantic string fields have `max_length` limits to prevent oversized AI prompts. Short identifiers ≤ 200 chars; long content fields ≤ 50,000 chars. |
| Nested JSON | `formData` ≤ 50 KB; `currentHtml` ≤ 200 KB; `html` ≤ 500 KB; `currentXml` ≤ 50 KB |

---

## 16. HTTP status codes

| Code | Plain-English meaning |
|---|---|
| **200** | Success |
| **302** | Redirect (e.g. after login/logout, or to Signavio Learning) |
| **400** | Bad input: invalid app_key, SSRF block (disallowed Confluence URL), or malformed request |
| **401** | Not logged in (rare — `AuthMiddleware` normally redirects to `/login` instead) |
| **403** | Logged in but not an admin (admin-only endpoint) |
| **404** | gen_id not found (the history item doesn't exist or was deleted) |
| **413** | File too large (over the 10 MB or 15 MB limit) |
| **422** | Pydantic validation failure (e.g. string too long) or invalid gen_id format |
| **500** | AI call failed, storage error, or unexpected internal error |
| **502** | AI authentication error or upstream HTTP error |
| **503** | Storage unavailable or AI network error |
| **504** | AI request timed out |

Errors **never** include Python exception details. Use `logger.exception(...)` server-side and return a user-friendly `message` field.

---

## 17. Error response format

All `/api/*` errors return this shape:

```json
{
  "status":  "error",
  "message": "Could not generate the BPMN diagram.",
  "detail":  "INTERNAL_ERROR"
}
```

* **`message`** = human-readable text shown to the user.
* **`detail`** = a stable code for programmatic handling (e.g. `INVALID_GEN_ID`, `STORAGE_UNAVAILABLE`, `SSRF_BLOCKED`, `BRAIN_TIMEOUT`). Never put Python exception text here.

---

## 18. Total surface

| Group | Count |
|---|---|
| OAuth / system | 4 |
| Pages | 11 |
| BPMN (incl. history) | 11 |
| PPT (incl. history) | 9 |
| Diagram (incl. history) | 11 |
| One-Pager (incl. history) | 7 |
| Audit Check | 2 |
| BPMN Checker | 1 |
| Spec Builder | 3 |
| Docupedia | 4 |
| Favorites | 3 |
| Feedback / Admin | 4 |
| User stats / Client log | 2 |
| **Total** | **≈ 72 endpoints** |

For end-to-end sequence diagrams of each app's flow, see [05-data-flow.md](05-data-flow.md).
