# 08 — Frontend Guide

The frontend is built with **server-rendered HTML + vanilla JavaScript**. There is no React, Vue, or any other SPA framework.

> **Server-rendered HTML** = the server builds the complete HTML page and sends it to the browser. Jinja2 is the Python template engine that fills in the variable parts (like the user's name or the changelog data).
>
> **Vanilla JS** = plain JavaScript with no framework. All shared utilities live in [common.js](../app/static/js/common.js).

All pages extend [base.html](../app/templates/base.html); shared design tokens (colours, sizes) live in [common.css](../app/static/css/common.css); shared JS helpers live in [common.js](../app/static/js/common.js).

This page is the contract every feature page is expected to follow.

---

## 1. Template hierarchy

```
base.html  ← every page extends this
├── index.html               (/)
├── ppt_creator.html         (/ppt-creator)
├── diagram_generator.html   (/diagram-generator)
├── signavio_bpmn.html       (/signavio-bpmn)
├── audit_check.html         (/audit-check)
├── bpmn_checker.html        (/bpmn-checker)
├── one_pager_creator.html   (/one-pager-creator)
├── fs_br_document.html      (/spec-builder)
├── docupedia_publisher.html (/docupedia-publisher)
├── admin.html               (/dscpadmin)
└── errors/{401,403,404}.html
```

### 1.1 Blocks defined in `base.html`

Jinja2 **template inheritance** works like a shared layout. `base.html` defines named "blocks" that child templates can override.

| Block | Purpose | Default |
|---|---|---|
| `title` | Browser tab title | `BSH DSCP` |
| `page_name` | Subtitle shown in the navbar | `BSH DSCP` |
| `extra_css` | Page-specific `<link>` tags (your feature CSS file) | empty |
| `content` | Main page content area | empty |
| `extra_js` | Page-specific `<script>` tags (your feature JS file) | empty |

Every CSS/JS link is appended with `?v={{ css_version }}` for **cache-busting**.

> **Cache-busting** = adding a version number to a file URL (e.g. `common.css?v=42`) forces the browser to download the new file rather than using the cached old version. The version number is `CSS_VERSION` in [app/core/config.py](../app/core/config.py). Bump it after any CSS/JS change.

### 1.2 `window.APP_CONFIG`

The base template injects a small JavaScript config block into every page so the frontend JS knows what environment it is running in:

```html
<script>
  window.APP_CONFIG = {
    env:                  "{{ app_env }}",          // "dev" (local) or "prod" (SAP BTP)
    clientLoggingEnabled: {{ client_logging|tojson }},
    clientLogLevel:       "{{ client_log_level }}", // controls which log levels are sent
    brainPortalUrl:       "{{ brain_portal_url }}", // link to the Bosch DIA Brain portal
    cssVersion:           "{{ css_version }}"
  };
</script>
```

`AppLogger` reads this config via `AppLogger.getConfig()`. **Never write to `window.APP_CONFIG` from your feature scripts.**

### 1.3 Base structure

```
<header.navbar>
  brand · theme toggle · tutorial · changelog bell · spring toggle
<div.beta-banner>
<main.page>{% block content %}</main>
<div.ai-warning-global>          (auto-dismissed after 5s)
<div#changelog.changelog-panel>  (rendered from `changelog` ctx)
<div#toast-container>            (Toast queue)
<div.ai-disclaimer-modal>        (first-visit acceptance)
<footer.site-footer>
```

---

## 2. Design tokens (`common.css`)

**Design tokens** = CSS variables that define the colour palette, spacing, shadows, etc. in one place. All feature CSS should use `var(--token-name)` instead of raw colour values. This ensures dark mode and brand changes only need to be updated in `common.css`.

> **Dark mode** is toggled by adding the class `dark-mode` to `<body>`. The CSS overrides all the token values under `body.dark-mode { ... }`. You get dark mode for free if you use the tokens. Only add manual `body.dark-mode` overrides for special cases (e.g. a custom shadow).

### 2.1 Color tokens

| Variable | Light | Dark override |
|---|---|---|
| `--brand-orange` | `#FF6840` | (same) |
| `--brand-orange-700` | `#FF6840` | (same) |
| `--navy-900` | `#0f172a` | `#f8fafc` |
| `--navy-800` | `#111827` | — |
| `--slate-800` | `#1f2937` | `#f1f5f9` |
| `--slate-700` | `#374151` | `#e2e8f0` |
| `--slate-600` | `#475569` | `#cbd5e1` |
| `--slate-500` | `#6b7280` | `#a8b8c8` |
| `--slate-400` | `#94a3b8` | `#8a9db2` |
| `--slate-300` | `#cbd5e1` | `#3d4f66` |
| `--slate-100` | `#f1f5f9` | `#283548` |
| `--border` | `#e5e7eb` | `#2a3a52` |
| `--bg` | `#f5f7fb` | `#0c1222` |
| `--card` | `#ffffff` | `#141d2f` |
| `--surface-hover` | `#fffbf8` | `#1a2740` |
| `--surface-secondary` | `#f8fafc` | `#182236` |
| `--text-primary` | `#0f172a` | `#f8fafc` |
| `--text-secondary` | `#64748b` | `#b8c5d6` |
| `--success` | `#1f9d55` | — |
| `--warning` | `#f59e0b` | — |
| `--danger` | `#dc2626` | — |
| `--info` | `#2563eb` | — |

### 2.2 Layout tokens

| Variable | Value |
|---|---|
| `--radius` | `16px` |
| `--shadow` | `0 12px 40px rgba(15, 23, 42, 0.12)` (dark: `rgba(0,0,0,0.5)`) |
| `--shadow-soft` | `0 6px 24px rgba(15, 23, 42, 0.08)` (dark: `rgba(0,0,0,0.3)`) |
| `--transition` | `all 0.2s ease` |

### 2.3 Reusable component classes

Group | Classes
---|---
**Buttons** | `.btn`, `.btn-primary`, `.btn-secondary`, `.btn-ghost`
**Loading (full-screen)** | `.lo-overlay`, `.lo-rings`, `.lo-ring-outer`, `.lo-ring-inner`, `.lo-status`, `.lo-text`, `.lo-dots`
**Loading (inline)** | `.lp-panel`, `.lp-rings`, `.lp-ring-*`, `.lp-status`
**Spinner** | `.spinner` (18px, orange)
**Toasts** | `.toast-container`, `.toast.{success,error,warning,info}`, `.toast .icon-wrap/.content/.title/.message/.close-btn/.progress`
**History (shared by all creators)** | `.history-panel`, `.history-header`, `.history-grid`, `.gen-card`, `.gen-card-body`, `.gen-card-title-row`, `.gen-card-title`, `.gen-card-badges`, `.gen-card-meta`, `.gen-card-actions`, `.gen-card-delete` (top-right)
**Modals** | `.confirmation-modal[.active]`, `.confirmation-content/.header/.icon/.title/.message/.actions`, `.modal-overlay`, `.modal-content`
**Tabs (segmented)** | `.mode-tabs`, `.mode-tab[.active]`
**Multi-step forms** | `.step-indicator`, `.step[.step-active|.step-completed]`, `.form-step[.active]`, `.form-navigation`
**Uploads** | `.upload-area[.drag-over]`, `.upload-placeholder`, `.upload-icon`, `.upload-hint`, `.file-item`, `.file-remove`
**Chat / refinement** | `.chat-container`, `.chat-messages`, `.chat-msg`, `.chat-user`, `.chat-input-row`
**Homepage cards** | `.app-grid`, `.app-card[.card-visible|.search-hidden|.filter-hidden|.locked]`
**Banners** | `.warning-notice`, `.ai-warning-global`, `.ai-warning-inner`, `.warning-icon`, `.warning-content`, `.beta-banner`, `.beta-badge`
**Changelog** | `.changelog-bell`, `.changelog-panel`, `.changelog-wrapper`, `.changelog-head`, `.changelog-content`, `.changelog-section`, `.changelog-list`
**Disclaimer** | `.ai-disclaimer-modal/.content/.icon/.title/.body/.actions`
**Feedback** | `.feedback-widget`, `.feedback-inner`, `.feedback-prompt`, `.feedback-ratings`, `.feedback-rating-btn`, `.feedback-thanks`
**Navbar / footer** | `.navbar`, `.navbar-shell`, `.navbar-actions`, `.brand`, `.brand-logo`, `.brand-text`, `.brand-name`, `.brand-sub`, `.site-footer`, `.footer-content`, `.footer-badge`, `.footer-text`, `.footer-credit`
**Decorative** | `.spring-mode`, `.spring-leaf-float`, `.spring-trail`, `.spring-petal`, `.sc-decorations`, `.sc-element`, `.sc-truck`, `.sc-package`, `.sc-warehouse`, `.sc-chart`, `.sc-globe`
**Layout** | `.page`, `.container`, `.eyebrow`, `.info-icon`

> **Rule of thumb**: before adding a new class, search [common.css](../app/static/css/common.css) — chances are the layout already exists.

---

## 3. Shared JS — `common.js`

The single shared JavaScript file loaded on every page. **Do not recreate any of these helpers** in your feature files — they are already available globally.

### 3.1 Global functions

| Function | When to use it |
|---|---|
| `showToast(message, type, duration?)` | Show a notification. Use instead of `alert()`. `type` ∈ `success/error/warning/info`. Default 4 s. |
| `escapeHtml(str)` | **Always** call this before inserting user text into `innerHTML`. Prevents XSS. |
| `formatFileSize(bytes)` | Converts bytes to human-readable string: `"12.5 KB"`, `"1.2 MB"`. |
| `showConfirmation(title, message, onConfirm, options?)` | Show a blocking confirm/cancel dialog. Pass a callback for what happens when the user confirms. |
| `closeConfirmation()` | Programmatically close the confirmation dialog. |

### 3.2 Namespaces

```js
Toast.show(msg, type, dur)  Toast.remove(t)  Toast.escape(v)

Utils.isEmpty(v)
Utils.isValidEmail(s)
Utils.apiRequest(url, opts)            // fetch w/ JSON Content-Type, returns parsed JSON
Utils.formDataToJson(fd)               // FormData → plain object
Utils.triggerBlobDownload(blob, fname) // anchor + revokeObjectURL

HistoryIcons.delete    // <svg> string
HistoryIcons.download  // <svg> string
HistoryIcons.open      // <svg> string

AppLogger.debug(msg, meta)
AppLogger.info(msg, meta)
AppLogger.warn(msg, meta)
AppLogger.error(msg, meta)             // also POSTs /api/client-log
AppLogger.getConfig() → {env, isProd, enabled, minLevel}

DOM.select(sel, parent?)
DOM.selectAll(sel, parent?)
DOM.create(tag, attrs?, content?)
DOM.empty(el)

LoadingOverlay.show({ messages, icon }) // full-screen rings, cycles every 2.5s
LoadingOverlay.hide()

LoadingPanel.show(elOrId, { messages, hint })   // inline (container needs flex)
LoadingPanel.hide(elOrId)

FeedbackWidget.show(container, app_key, () => gen_id)
// posts to /api/feedback/{app_key} with {gen_id, rating}
```

### 3.3 Driver.js tutorials

```js
window.DSCPTutorial.startCurrent()       // detect path, start tour
window.DSCPTutorial.register(path, [steps])
```

Tutorials are registered per page (`/`, `/diagram-generator`, `/signavio-bpmn`, `/ppt-creator`, `/audit-check`, `/bpmn-checker`, `/one-pager-creator`, `/spec-builder`, `/docupedia-publisher`). The Driver.js library is lazy-loaded from `/static/js/driver.iife.js`.

### 3.4 Persisted UI state (localStorage)

| Key | Values | Purpose |
|---|---|---|
| `dscp_theme` | `light` / `dark` | Toggles `body.dark-mode` |
| `dscp_spring` | `on` / `off` | Toggles `body.spring-mode` |
| `dscp_last_seen_version` | semver string | Hides the changelog bell red dot |
| `dscp_ai_disclaimer_accepted` | `true` | Suppresses the first-visit modal |

Theme toggle button id: `#themeToggle` (with `.spinning` animation while transitioning). Spring toggle: `#springToggle`.

---

## 4. Tab & history conventions

### 4.1 Diagram generator (`.dg-tab-nav` / `.dg-tab-btn`)

```html
<div class="dg-tab-nav">
  <button class="dg-tab-btn active" data-tab="generate"><svg>…</svg> Generate</button>
  <button class="dg-tab-btn"        data-tab="history"><svg>…</svg> My History</button>
</div>
<div class="dg-content" data-tab-panel="generate">…</div>
<div class="dg-content" data-tab-panel="history">…</div>
```

### 4.2 PPT creator (`.ppt-tab-nav` / `.ppt-tab-btn`)

Mirror of the Diagram pattern with `id="tab-generate-btn"` / `id="tab-history-btn"`.

### 4.3 BPMN builder (two-level)

```html
<!-- Top-level history vs build -->
<div class="bpmn-tab-nav">
  <button class="bpmn-tab-btn active" data-tab="build">Build</button>
  <button class="bpmn-tab-btn"        data-tab="history">My History</button>
</div>

<!-- Mode switch (Form vs Upload) -->
<div class="mode-tabs" id="bpmnModeTabs">
  <button class="mode-tab active" data-mode="form">Form Builder</button>
  <button class="mode-tab"        data-mode="upload">Upload &amp; Build</button>
</div>
```

### 4.4 History card layout (shared by every creator)

```
.history-panel
  .history-header                       (title + search + refresh)
  .history-grid
    .gen-card
      .gen-card-delete                  (top-right SVG dustbin)
      .gen-card-body
        .gen-card-title-row
          .gen-card-title
          .gen-card-badges
        .gen-card-meta
        .gen-card-actions               (Open / Download)
```

> Mandatory: history cards use **SVG icons only** (from `HistoryIcons`), never emoji. Delete button always at top-right. Reuse class names verbatim — `signavio_bpmn.js`, `ppt_creator.js`, `diagram_generator.js`, `one_pager_creator.js` all bind events on these classes.

---

## 5. Feature CSS / JS pairs

| Feature | Template | CSS | JS |
|---|---|---|---|
| Homepage | `index.html` | `common.css` | `common.js` + `homepage_bg.js` |
| PPT Creator | `ppt_creator.html` | `ppt_creator.css` | `ppt_creator.js` |
| Diagram Generator | `diagram_generator.html` | `diagram_generator.css` | `diagram_generator.js` |
| BPMN Builder | `signavio_bpmn.html` | `signavio_bpmn.css` | `signavio_bpmn.js` |
| Audit Check | `audit_check.html` | `audit_check.css` | `audit_check.js` |
| BPMN Checker | `bpmn_checker.html` | `bpmn_checker.css` | `bpmn_checker.js` |
| One-Pager Creator | `one_pager_creator.html` | `one_pager_creator.css` | `one_pager_creator.js` |
| Spec Builder | `fs_br_document.html` | `fs_br_document.css` | `fs_br_document.js` |
| Docupedia Publisher | `docupedia_publisher.html` | `docupedia_publisher.css` | `docupedia_publisher.js` |
| Admin Dashboard | `admin.html` | `admin.css` | `admin.js` |

### 5.1 Vendored third-party

| File | Purpose |
|---|---|
| `static/js/driver.iife.js` + `static/css/driver.css` | Driver.js tours (lazy-loaded) |
| `static/js/html2canvas.min.js` | DOM → canvas screenshot (used by exporters) |
| `static/js/three.min.js` | Three.js (homepage 3D background, optional features) |

### 5.2 Data files

| File | Contents |
|---|---|
| `static/data/changelog_dev.json` | Dev changelog versions |
| `static/data/changelog_prod.json` | Prod changelog versions |

The changelog file shown is selected by `app_env` in `pages.py` and passed to the template as `changelog`.

---

## 6. UX rules (mandatory)

1. **No emoji** in PPT-creator, BPMN-builder, history cards, status indicators, mode tabs, or feedback buttons. Use inline `<svg>` icons (or the `HistoryIcons.*` strings).
2. **No `alert()`**. Use `showToast(...)` for transient messages and `showConfirmation(...)` for blocking decisions.
3. **No raw `innerHTML` of user input**. Always call `escapeHtml()` first to prevent XSS attacks.
4. **No new colour literals.** Use `var(--...)` CSS variables from §2 so dark mode keeps working.
5. **No new history-card markup.** Reuse the existing `gen-card*` classes so existing JavaScript event bindings keep working.
6. **CSS-version cache busting**: bump `CSS_VERSION` in [app/core/config.py](../app/core/config.py) after any CSS/JS change, so users load the new file instead of a cached old one.
7. **Dark mode is automatic** if you use the design tokens. Only override under `body.dark-mode { … }` if you need a special shadow or image.
8. **Accessibility**: every icon-only button needs `aria-label`. Pressing `Esc` must close modals.

---

## 7. Adding a new feature page — checklist

1. Create `app/templates/myfeature.html` extending `base.html`.
2. Create `app/static/css/myfeature.css` and `app/static/js/myfeature.js`.
3. Reuse tokens, history-card pattern, mode-tabs, `LoadingOverlay`, `showToast`, `escapeHtml`, `Utils.apiRequest`.
4. Register a tutorial: `DSCPTutorial.register('/my-feature', [...steps])`.
5. Add a page route in [app/routers/pages.py](../app/routers/pages.py) with `track_click("myapp", user_id)`.
6. Register the app key in `APP_LABELS` ([analytics_service.py](../app/services/History/analytics_service.py)) and `ALLOWED_APP_KEYS` ([favorites_service.py](../app/services/History/favorites_service.py)).
7. Bump `CSS_VERSION`.
8. Add a changelog entry to `static/data/changelog_*.json`.

That's the whole frontend. The deployment story continues in [09-deployment.md](09-deployment.md).
