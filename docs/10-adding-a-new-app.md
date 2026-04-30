# 10 — Adding a New App

> The "secret" is that every app in DSCP_AI is just **the same six-step pattern** repeated. Each feature is a thin slice through the same stack: a Jinja page route → a JS/CSS pair → an API route → a service → optional history. Everything else (auth, storage, analytics, theming, toast, loading) is already wired for you.

Read this alongside [01-architecture.md](01-architecture.md) for the big picture and [08-frontend-guide.md](08-frontend-guide.md) for UI conventions.

---

## 0. The secret pattern (read this first)

Every existing app — PPT Creator, BPMN Builder, Diagram Generator, etc. — is wired the same way:

```
pages.py             → HTML route + track_click
api.py               → JSON route(s) + validation
myfeature_service.py → Brain call(s) via common_service helpers
myfeature_history.py → CRUD over Object Store (optional)
analytics_service.py → APP_LABELS entry + (auto) track_generation
favorites_service.py → ALLOWED_APP_KEYS entry
templates/my.html    → extends base.html
static/css/my.css    → only tokens, no raw colours
static/js/my.js      → Utils.apiRequest, showToast, LoadingOverlay
```

If you touch **all nine** of these locations consistently, the app works end-to-end including auth, history, analytics, dark mode, and production SSE-AES256 storage on the first deploy.

---

## 1. Pick your app key

The **app key** is the short identifier that ties everything together. Choose a lowercase hyphen-separated slug:

```
"my-tool"   ← good
"MyTool"    ← bad
"tool_v2"   ← avoid underscores
```

You will use it verbatim in `APP_LABELS`, `ALLOWED_APP_KEYS`, `track_click`, `track_generation`, history prefixes, and `FeedbackWidget.show(...)`.

---

## 2. Register in analytics and favorites

These two files must come first — other code references them.

### `app/services/History/analytics_service.py`

```python
APP_LABELS = {
    # ... existing entries ...
    "my-tool": "My Tool Display Name",   # add here
}
```

### `app/services/History/favorites_service.py`

```python
ALLOWED_APP_KEYS = frozenset({
    # ... existing entries ...
    "my-tool",   # add here
})
```

No other code change needed in these files.

---

## 3. Create the service layer

Create `app/services/my_tool_service.py`. **All Brain calls go through the helpers in `common_service.py`** — never build raw `httpx` calls in a feature service.

```python
# app/services/my_tool_service.py
import logging
from app.services.common_service import (
    create_chat_history,
    upload_attachments,
    call_brain_workflow,          # or call_brain_pure_llm / call_brain_chat
)
from app.core.config import settings

logger = logging.getLogger(__name__)

MY_TOOL_BRAIN_ID   = settings.MY_TOOL_BRAIN_ID        # read from env
MY_TOOL_WORKFLOW_ID = settings.MY_TOOL_WORKFLOW_ID     # if needed

async def generate_my_tool(
    content: str,
    files: list[bytes] | None = None,
    filenames: list[str] | None = None,
) -> dict:
    """Return {result, chatHistoryId} or raise ValueError on failure."""
    chat_history_id = await create_chat_history()
    if not chat_history_id:
        raise ValueError("Could not create Brain chat history.")

    attachment_ids: list[str] = []
    if files:
        attachment_ids = await upload_attachments(files, filenames or [])

    prompt = _build_prompt(content)

    result = await call_brain_workflow(
        workflow_id=MY_TOOL_WORKFLOW_ID,
        brain_id=MY_TOOL_BRAIN_ID,
        chat_history_id=chat_history_id,
        message=prompt,
        attachment_ids=attachment_ids,
        custom_behaviour="",          # optional system instruction override
    )

    if not result:
        raise ValueError("Empty response from Brain.")

    return {"result": result, "chatHistoryId": chat_history_id}


def _build_prompt(content: str) -> str:
    # Sanitise user input before embedding in prompt
    from app.services.common_service import sanitize_filename_for_prompt
    safe = sanitize_filename_for_prompt(content)
    return f"Please process the following:\n\n{safe}"
```

### Which `call_brain_*` to use?

| Helper | Use when |
|---|---|
| `call_brain_workflow` | You have a structured Brain workflow with a workflow ID (most features). |
| `call_brain_pure_llm` | Free-form prompt, no workflow (Docupedia drafts). |
| `call_brain_chat` | Follow-up turns in a multi-turn conversation (refinement/chat). |

All three accept `chat_history_id` so refinement / follow-up always works.

### Environment variable

Add to `app/core/config.py` (or wherever the settings class lives):

```python
MY_TOOL_BRAIN_ID:    str = ""
MY_TOOL_WORKFLOW_ID: str = ""
```

Add to `.env` locally and `cf set-env` in production (see [09-deployment.md §5.1](09-deployment.md#51-first-time-deploy)).

---

## 4. Create the history service (optional)

Skip this section if your app is **stateless** (like Audit Check, BPMN Checker). If your app produces a result the user will want to reload, create a history service.

```python
# app/services/History/my_tool_history_service.py
import logging
from app.services.History.common_history import (
    get_history, get_generation_content,
    save_content, append_and_prune,
    delete_generation, new_gen_id, now_iso,
)
from app.services.History.analytics_service import track_generation

logger = logging.getLogger(__name__)

_PREFIX   = "my-tool-history"
_MAX_ENTRIES = 50            # lower (e.g. 30) if payloads are large

async def save_generation(user_id: str, content: dict, chat_history_id: str) -> str | None:
    gen_id = new_gen_id()
    entry = {
        "id":            gen_id,
        "title":         content.get("title", "Untitled"),
        "chatHistoryId": chat_history_id,
        "createdAt":     now_iso(),
        "updatedAt":     now_iso(),
    }
    ok = await save_content(_PREFIX, user_id, gen_id, content)
    if not ok:
        return None
    await append_and_prune(_PREFIX, user_id, gen_id, entry, _MAX_ENTRIES)
    await track_generation("my-tool")    # ← always call this on a new generation
    return gen_id

async def get_history_list(user_id: str) -> list[dict]:
    return await get_history(_PREFIX, user_id)

async def get_generation(user_id: str, gen_id: str) -> dict | None:
    return await get_generation_content(_PREFIX, user_id, gen_id)

async def delete_entry(user_id: str, gen_id: str) -> bool:
    return await delete_generation(_PREFIX, user_id, gen_id)
```

Rules:
* **Always call `track_generation("my-tool")`** in `save_generation` — never anywhere else.
* **50-entry cap** keeps Object Store bounded; lower it for HTML payloads (30).
* Content blob can be any JSON-serialisable dict.
* `append_and_prune` handles index reads/writes and deletes pruned content blobs automatically.

---

## 5. Add routes

### 5.1 Page route — `app/routers/pages.py`

```python
@router.get("/my-tool")
async def my_tool_page(request: Request):
    user_info = get_current_user(request)
    user_id   = user_info.get("user", "anonymous")
    asyncio.create_task(track_click("my-tool", user_id))
    return _render_template("my_tool.html", request)
```

That is literally all a page route does. Do not add logic here.

### 5.2 API routes — new module under `app/routers/api/`

> **Pattern:** create a new feature module `app/routers/api/<feature>.py` that exposes its own `router = APIRouter()`, then register it in [`app/routers/api/__init__.py`](../app/routers/api/__init__.py) with `router.include_router(<feature>.router)`. Shared helpers (`_validate_magic`, `_validate_gen_id`, `MAX_UPLOAD_SIZE`, `_FILE_MAGIC`, `logger`) live in [`app/routers/api/_shared.py`](../app/routers/api/_shared.py).

Follow the existing pattern: **Pydantic model first, handler second**.

```python
class MyToolGenerateRequest(BaseModel):
    content:  str = Field("", max_length=10_000)
    topic:    str = Field("", max_length=200)

class MyToolHistorySaveRequest(BaseModel):
    content:       dict
    chatHistoryId: str = Field(..., max_length=200)


@router.post("/my-tool/generate")
async def my_tool_generate(request: Request, body: MyToolGenerateRequest):
    user_info = get_current_user(request)
    try:
        result = await my_tool_service.generate_my_tool(body.content)
        return JSONResponse({"status": "success", **result})
    except ValueError as exc:
        logger.exception("my-tool generate failed")
        return JSONResponse({"status": "error", "message": "Could not generate."}, status_code=500)


# — History routes (if you created a history service) —

@router.get("/my-tool/history")
async def my_tool_history(request: Request):
    user_info = get_current_user(request)
    entries   = await my_tool_history_service.get_history_list(user_info["user"])
    return JSONResponse({"status": "success", "history": entries})


@router.get("/my-tool/history/{gen_id}")
async def my_tool_history_get(request: Request, gen_id: str):
    _validate_gen_id(gen_id)          # raises HTTPException(422) on bad UUID
    user_info = get_current_user(request)
    entry = await my_tool_history_service.get_generation(user_info["user"], gen_id)
    if not entry:
        return JSONResponse({"status": "error", "message": "Not found."}, status_code=404)
    return JSONResponse({"status": "success", "content": entry})


@router.post("/my-tool/history")
async def my_tool_history_save(request: Request, body: MyToolHistorySaveRequest):
    user_info = get_current_user(request)
    gen_id = await my_tool_history_service.save_generation(
        user_info["user"], body.content, body.chatHistoryId
    )
    if not gen_id:
        return JSONResponse({"status": "error", "message": "Could not save."}, status_code=503)
    return JSONResponse({"status": "success", "genId": gen_id})


@router.delete("/my-tool/history/{gen_id}")
async def my_tool_history_delete(request: Request, gen_id: str):
    _validate_gen_id(gen_id)
    user_info = get_current_user(request)
    ok = await my_tool_history_service.delete_entry(user_info["user"], gen_id)
    return JSONResponse({"status": "success" if ok else "error"})
```

**Security checklist for every API handler:**

- [ ] `get_current_user(request)` called at the top (auth gate)
- [ ] All user strings go through `Field(max_length=…)` in the Pydantic model
- [ ] File uploads validated with `_validate_magic(content, filename)` — never trust `content_type`
- [ ] `gen_id` path params go through `_validate_gen_id(gen_id)`
- [ ] Errors log with `logger.exception(...)`, return a generic `message` only — no `str(exc)`
- [ ] User-supplied strings embedded in prompts pass through `sanitize_filename_for_prompt`

For file uploads, mirror the existing `ppt/extract` or `diagram/analyze` endpoints exactly — they already do size checks, magic-byte checks, and multi-file logic.

---

## 6. Build the frontend

### 6.1 Template — `app/templates/my_tool.html`

```jinja
{% extends "base.html" %}

{% block title %}My Tool — BSH DSCP{% endblock %}
{% block page_name %}My Tool{% endblock %}

{% block extra_css %}
<link rel="stylesheet" href="/static/css/my_tool.css?v={{ css_version }}">
{% endblock %}

{% block content %}
<div class="container">
  <!-- mode tabs (if you have multiple modes) -->
  <div class="mode-tabs" id="myToolTabs">
    <button class="mode-tab active" data-mode="generate">Generate</button>
    <button class="mode-tab"        data-mode="history">My History</button>
  </div>

  <!-- generate panel -->
  <div id="generatePanel">
    <div class="upload-area" id="uploadArea">…</div>
    <button class="btn btn-primary" id="generateBtn">Generate</button>
  </div>

  <!-- history panel (if applicable) -->
  <div id="historyPanel" class="history-panel" hidden>
    <div class="history-header">…</div>
    <div class="history-grid" id="historyGrid"></div>
  </div>
</div>
{% endblock %}

{% block extra_js %}
<script src="/static/js/my_tool.js?v={{ css_version }}"></script>
{% endblock %}
```

### 6.2 CSS — `app/static/css/my_tool.css`

```css
/* Only feature-specific overrides. Use var(--…) from common.css for everything else. */

#generatePanel {
  background: var(--card);
  border-radius: var(--radius);
  box-shadow: var(--shadow-soft);
  padding: 2rem;
}

body.dark-mode #generatePanel {
  /* only override if the token doesn't auto-flip */
  border: 1px solid var(--border);
}
```

Do **not** redeclare colours with hex literals. If it's in [common.css](../app/static/css/common.css), use the token.

### 6.3 JS — `app/static/js/my_tool.js`

Minimal skeleton:

```js
// my_tool.js
(function () {
  "use strict";

  // ── DOM refs ────────────────────────────────────────────────────────
  const generateBtn  = DOM.select("#generateBtn");
  const historyGrid  = DOM.select("#historyGrid");

  // ── State ────────────────────────────────────────────────────────────
  let currentContent   = null;
  let currentChatId    = null;

  // ── Generate ─────────────────────────────────────────────────────────
  generateBtn.addEventListener("click", async () => {
    LoadingOverlay.show({ messages: ["Generating…", "Almost there…"] });
    try {
      const data = await Utils.apiRequest("/api/my-tool/generate", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ content: getInput() }),
      });
      if (data.status !== "success") throw new Error(data.message);
      currentContent = data.result;
      currentChatId  = data.chatHistoryId;
      renderResult(data.result);
      await saveToHistory(data.result, data.chatHistoryId);
    } catch (err) {
      AppLogger.error("Generate failed", { error: err.message });
      showToast(err.message || "Generation failed.", "error");
    } finally {
      LoadingOverlay.hide();
    }
  });

  // ── History ──────────────────────────────────────────────────────────
  async function loadHistory() {
    const data = await Utils.apiRequest("/api/my-tool/history");
    if (data.status !== "success") return;
    DOM.empty(historyGrid);
    data.history.forEach(renderHistoryCard);
  }

  function renderHistoryCard(entry) {
    const card = DOM.create("div", { className: "gen-card" });
    card.innerHTML = `
      <button class="gen-card-delete" aria-label="Delete">${HistoryIcons.delete}</button>
      <div class="gen-card-body">
        <div class="gen-card-title-row">
          <span class="gen-card-title">${escapeHtml(entry.title)}</span>
        </div>
        <div class="gen-card-meta">${escapeHtml(entry.createdAt?.slice(0, 10) ?? "")}</div>
        <div class="gen-card-actions">
          <button class="btn btn-secondary btn-sm js-open">${HistoryIcons.open} Open</button>
        </div>
      </div>`;

    card.querySelector(".gen-card-delete").addEventListener("click", () =>
      showConfirmation("Delete?", "This cannot be undone.", () => deleteEntry(entry.id, card))
    );
    card.querySelector(".js-open").addEventListener("click", () => openEntry(entry.id));
    historyGrid.appendChild(card);
  }

  async function saveToHistory(content, chatHistoryId) {
    await Utils.apiRequest("/api/my-tool/history", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ content, chatHistoryId }),
    });
  }

  async function deleteEntry(genId, cardEl) {
    await Utils.apiRequest(`/api/my-tool/history/${genId}`, { method: "DELETE" });
    cardEl.remove();
    showToast("Deleted.", "success");
  }

  async function openEntry(genId) {
    const data = await Utils.apiRequest(`/api/my-tool/history/${genId}`);
    if (data.status === "success") renderResult(data.content);
  }

  // ── Helpers ───────────────────────────────────────────────────────────
  function getInput() { return DOM.select("#myInput")?.value.trim() ?? ""; }
  function renderResult(result) { /* update DOM */ }

  // ── Init ──────────────────────────────────────────────────────────────
  loadHistory();
})();
```

Rules:
* **No raw `innerHTML` of user content** — always `escapeHtml(...)`.
* **Never `alert()`** — use `showToast(...)` and `showConfirmation(...)`.
* **All API calls** via `Utils.apiRequest` (handles JSON and propagates errors consistently).
* **Loading states** via `LoadingOverlay.show/hide` or `LoadingPanel.show/hide`.
* **Log errors** via `AppLogger.error(msg, meta)` — this also POSTs to `/api/client-log`.
* **History cards** must use `gen-card` / `gen-card-*` classes and SVG icons from `HistoryIcons`. No emoji.

---

## 7. Register a Driver.js tutorial (recommended)

In `my_tool.js`, at the bottom of the IIFE:

```js
if (window.DSCPTutorial) {
  DSCPTutorial.register("/my-tool", [
    { element: "#uploadArea",   popover: { title: "Step 1 — Upload",   description: "Drop your PDF here." } },
    { element: "#generateBtn",  popover: { title: "Step 2 — Generate", description: "Click to start." } },
    { element: "#historyPanel", popover: { title: "Step 3 — History",  description: "Revisit past results." } },
  ]);
}
```

The navbar tutorial button will then offer a guided tour on your page automatically.

---

## 8. Add a changelog entry

Edit `app/static/data/changelog_dev.json` (and `changelog_prod.json` when shipping):

```json
{
  "version": "1.X.0",
  "date": "YYYY-MM-DD",
  "sections": [
    {
      "title": "New App",
      "items": ["Added My Tool — does X, Y, Z."]
    }
  ]
}
```

---

## 9. Add to the homepage

`app/templates/index.html` — find the `.app-grid` section and add an `.app-card`:

```html
<a href="/my-tool" class="app-card" data-tags="my-tool keyword1">
  <div class="app-card-icon">
    <svg>…</svg>
  </div>
  <div class="app-card-content">
    <h3 class="app-card-name">My Tool</h3>
    <p class="app-card-desc">One-line description.</p>
  </div>
</a>
```

`data-tags` drives the homepage search bar (in `common.js` `initAppSearch`).

---

## 10. Environment variables & deployment

1. Add to `app/core/config.py` settings:
   ```python
   MY_TOOL_BRAIN_ID: str = ""
   MY_TOOL_WORKFLOW_ID: str = ""
   ```

2. Add to local `.env`:
   ```
   MY_TOOL_BRAIN_ID=<brain-workflow-id>
   MY_TOOL_WORKFLOW_ID=<workflow-id>
   ```

3. In production:
   ```bash
   cf set-env dscp-ai MY_TOOL_BRAIN_ID    "<value>"
   cf set-env dscp-ai MY_TOOL_WORKFLOW_ID "<value>"
   cf restage dscp-ai
   ```

4. Bump `CSS_VERSION` in `app/core/config.py` so browsers pick up new assets.

---

## 11. Complete file checklist

```
NEW files
─────────
app/templates/my_tool.html
app/static/css/my_tool.css
app/static/js/my_tool.js
app/services/my_tool_service.py
app/services/History/my_tool_history_service.py   ← skip if stateless

MODIFIED files
──────────────
app/services/History/analytics_service.py  → add "my-tool" to APP_LABELS
app/services/History/favorites_service.py  → add "my-tool" to ALLOWED_APP_KEYS
app/core/config.py                         → add MY_TOOL_BRAIN_ID, bump CSS_VERSION
app/routers/pages.py                       → add page route + track_click
app/routers/api/<feature>.py               → NEW: feature router + Pydantic models
app/routers/api/__init__.py                → MODIFIED: register new sub-router
app/templates/index.html                   → add app-card
app/static/data/changelog_dev.json         → add version entry
.env (local)                               → add new env vars
manifest.yml (optional)                    → document env vars (secrets via cf set-env)
```

That's 5 new files and 9 file edits. If you have them all, your app will work end-to-end in dev and production on the first push.

---

## 12. Quick sanity checks

```
[ ] GET /my-tool returns 200 (unauthenticated → redirect to /login)
[ ] GET /my-tool returns HTML after login
[ ] POST /api/my-tool/generate with valid body returns {status: "success"}
[ ] POST /api/my-tool/generate with oversized body returns 413
[ ] POST /api/my-tool/generate with a .exe file returns 400 (magic-byte rejection)
[ ] GET /api/my-tool/history returns [] for a new user
[ ] POST /api/my-tool/history saves, GET /api/my-tool/history returns 1 entry
[ ] DELETE /api/my-tool/history/{gen_id} removes the entry
[ ] GET /api/admin/analytics shows "my-tool" click after page visit
[ ] My Tool appears in the favorites toggle on the homepage
[ ] Dark-mode toggle looks correct on the page
[ ] Driver.js tutorial runs from the navbar button
```

See [09-deployment.md](09-deployment.md) for the full production deploy checklist.
