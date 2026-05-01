# 05 — Data Flows

Step-by-step sequence diagrams for every major user action in the app.

**Key to abbreviations used in all diagrams below:**

| Abbreviation | Full name | Plain-English description |
|---|---|---|
| **B** | Browser | The user's browser / JavaScript frontend |
| **R** | Route handler | The FastAPI endpoint (e.g. `/api/ppt/extract`) |
| **S** | Feature service | The feature's Python service file (e.g. `ppt_creator_service.py`) |
| **C** | common_service | The shared helper that builds all AI requests |
| **DB** | DIA Brain | Bosch's internal AI service |
| **OS** | Object Store | BTP cloud file storage (like Amazon S3) |
| **H** | History service | The feature's history save/load service |
| **A** | analytics_service | Records usage counts |

---

## 1. PPT Creator — extract → refine → download → save

**What this flow does:** The user uploads files and a topic. The app creates an AI chat session, uploads the files to the AI, sends a prompt, gets back slide content, and returns it. The user can then refine the slides via follow-up messages, download a `.pptx` file, and save to history.

```mermaid
sequenceDiagram
    autonumber
    participant B
    participant R as /api/ppt/*
    participant S as ppt_creator_service
    participant C as common_service
    participant DB as DIA Brain
    participant H as ppt_history_service
    participant A as analytics_service

    B->>R: POST /api/ppt/extract (files + topic)
    R->>R: validate magic-bytes per file, total ≤ 10MB
    R->>S: extract_slides(files, topic, user)
    S->>C: create_chat_history(PPT_BRAIN_ID)
    C->>DB: POST /chat-histories/{id}
    DB-->>C: chatHistoryId
    C-->>S: chatHistoryId
    S->>C: upload_attachments(PPT_BRAIN_ID, files)
    C->>DB: POST /chat-attachments
    DB-->>C: attachmentIds
    S->>C: call_brain_workflow_chat(prompt, chatHistoryId, attachmentIds)
    C->>DB: POST /chat/workflow
    DB-->>C: result (slides JSON or markdown)
    C-->>S: parsed result
    S-->>R: {slides, chatHistoryId, ...}
    R->>A: track_generation("ppt") (best-effort, async task)
    R-->>B: 200 JSON

    B->>R: POST /api/ppt/refine (chatHistoryId, message)
    R->>S: refine(...)
    S->>C: call_brain_workflow_chat(prompt, chatHistoryId)
    C->>DB: POST /chat/workflow
    DB-->>C: refined slides
    S-->>R: slides
    R-->>B: 200 JSON

    B->>R: POST /api/ppt/download (slides JSON)
    R->>S: build_pptx(slides, template=potx)
    S-->>R: bytes
    R->>A: track_download("ppt")
    R-->>B: streamed .pptx

    B->>R: POST /api/ppt/history (slides + meta)
    R->>H: save_generation(user, slides, meta)
    H->>OS: PutObject content.json
    H->>OS: PutObject index.json (prepended, max 50)
    H-->>R: gen_id
    R-->>B: 200 {gen_id}
```

Key invariants:
* `chatHistoryId` is the same handle from extract → refine → save. Refine calls without it would lose conversation context.
* `track_generation` is fired with `asyncio.create_task` and never blocks the response.
* The history save is explicit (a separate API call) — the user opts in via the UI.

---

## 2. Diagram Generator — analyze → generate → refine → download

**What this flow does:** User uploads source documents. The AI analyses them and suggests diagram types. The user picks types and the AI generates draw.io XML. Diagrams can be refined via chat and downloaded.

```mermaid
sequenceDiagram
    autonumber
    participant B
    participant R as /api/diagram/*
    participant S as diagram_generator_service
    participant C as common_service
    participant DB as DIA Brain
    participant H as diagram_history_service

    B->>R: POST /api/diagram/analyze (files)
    R->>S: analyze(files)
    S->>C: extract_pdf_text + upload_attachments
    S->>C: call_brain_workflow_chat (prompt = "analyze these documents")
    C->>DB: /chat/workflow
    DB-->>C: analysis text + suggested diagram types
    S-->>R: {analysis, extractedText, chatHistoryId, attachmentIds}
    R-->>B: 200

    B->>R: POST /api/diagram/generate (analysis + extractedText + types)
    R->>S: generate_diagrams(...)
    S->>C: call_brain_workflow_chat (prompt = "generate draw.io xml")
    C->>DB: /chat/workflow
    DB-->>C: list of {type, name, xml}
    S-->>R: diagrams[]
    R-->>B: 200

    B->>R: POST /api/diagram/refine (diagram_xml + message)
    R->>S: refine_diagram(...)
    S->>C: call_brain_workflow_chat
    DB-->>C: new xml
    S-->>R: refined xml
    R-->>B: 200

    B->>R: POST /api/diagram/download (diagram or all)
    R->>S: package_drawio(diagrams)
    S-->>R: .drawio bytes
    R-->>B: file download
```

The "Copy as Diagram" mode skips analysis and goes straight to `/api/diagram/copy-image` — single image only.

---

## 3. BPMN Builder — two paths into the same AI

**What this flow does:** Either the user fills in a form describing a process (Form Builder mode), or uploads an existing document (Upload & Build mode). Either way, the AI generates BPMN 2.0 XML that can be imported into Signavio.

```mermaid
sequenceDiagram
    autonumber
    participant B
    participant R as /api/bpmn/*
    participant S as signavio_service
    participant DB as DIA Brain

    alt Form Builder mode
        B->>R: POST /api/bpmn/start-session (form fields)
        R->>S: start_session(...)
        S->>DB: workflow chat (analysis behaviour, no XML)
        DB-->>S: analysis + chatHistoryId
        S-->>R: {analysis, chatHistoryId}
        R-->>B: 200

        loop chat
            B->>R: POST /api/bpmn/chat
            R->>S: chat(...)
            S->>DB: workflow chat (analysis behaviour)
            DB-->>S: analysis text
            S-->>R: text
            R-->>B: 200
        end
    else Upload & Build mode
        B->>R: POST /api/bpmn/upload-analyze (file)
        R->>S: upload_analyze(file)
        S->>DB: workflow chat (upload-analysis behaviour)
        DB-->>S: "[DOCUMENT_VALID]\n..." or "[DOCUMENT_INVALID]\n..."
        S-->>R: parsed result
        R-->>B: 200 (UI may stop on invalid)
    end

    B->>R: POST /api/generate-bpmn (chatHistoryId)
    R->>S: generate_bpmn(chatHistoryId)
    S->>DB: workflow chat (generation behaviour, XML only)
    DB-->>S: BPMN 2.0 XML
    S-->>R: xml
    R-->>B: 200 + XML
```

The `[DOCUMENT_VALID]` / `[DOCUMENT_INVALID]` first-line tag is a **prompt-engineering contract** between the upload-analysis behaviour and the JS. Don't break it.

---

## 4. Audit Check — analyse + chat with attachments

**What this flow does:** User uploads a document. The AI analyses it for compliance/quality issues. The user can then ask follow-up questions, optionally attaching more files. There is no history — the conversation ends when the tab closes.

```mermaid
sequenceDiagram
    autonumber
    participant B
    participant R as /api/audit-*
    participant S as audit_service
    participant DB as DIA Brain

    B->>R: POST /api/audit-doc-check (file)
    R->>S: analyze_document(file)
    S->>DB: create chat history + workflow chat
    DB-->>S: initial findings + chatHistoryId
    S-->>R: {analysis, chatHistoryId}
    R-->>B: 200

    loop user Q&A
        B->>R: POST /api/audit-chat (chatHistoryId + message + optional file)
        R->>S: chat(chatHistoryId, message, file?)
        opt file present
            S->>DB: upload attachment
        end
        S->>DB: workflow chat
        DB-->>S: answer
        S-->>R: answer
        R-->>B: 200
    end
```

No history — when the tab closes, the conversation is gone. This is intentional: audit findings are exploratory.

---

## 5. Docupedia Publisher — verify → generate → refine → publish

**What this flow does:** User verifies a Confluence connection using their Personal Access Token (PAT). Then uploads files and the AI generates a Confluence-format XML page. After optional refinement, the page is published directly to Docupedia via the Confluence REST API.

> **PAT = Personal Access Token**: A password-like token the user creates in their Confluence profile. The app uses it only for the current request and never saves or logs it.

```mermaid
sequenceDiagram
    autonumber
    participant B
    participant R as /api/confluence-builder/*
    participant S as confluence_builder_service
    participant DB as DIA Brain
    participant CF as Confluence (Docupedia)

    B->>R: POST /verify-connection (PAT, baseUrl, space, parentPage)
    R->>S: _validate_confluence_url(url)
    S->>CF: GET /rest/api/content/<parent>?expand=…
    CF-->>S: page metadata
    S-->>R: {valid, info}
    R-->>B: 200

    B->>R: POST /generate (files + manifest)
    R->>S: build_storage_xml(...)
    S->>DB: pure-LLM chat (Confluence storage XML behaviour)
    DB-->>S: storageXml + summary
    S-->>R: {title, summary, storageXml, warnings}
    R-->>B: 200

    loop refine
        B->>R: POST /refine (chatHistoryId + message)
        R->>S: refine(...)
        S->>DB: pure-LLM chat
        DB-->>S: storageXml
        S-->>R: {storageXml}
        R-->>B: 200
    end

    B->>R: POST /publish (PAT, page, storageXml, attachments)
    R->>S: publish(...)
    S->>CF: PUT /rest/api/content (or POST new page)
    CF-->>S: page id
    S->>CF: POST /rest/api/content/{id}/child/attachment for each
    CF-->>S: ok
    S-->>R: {url, pageId}
    R-->>B: 200
```

The PAT travels in `Authorization: Bearer …` only. It is never logged, never persisted to the Object Store, and dropped from memory after the request.

---

## 6. One Pager Creator — extract → refine → save

**What this flow does:** Same shape as PPT Creator, but the AI produces a single-page HTML document instead of slides.

```mermaid
sequenceDiagram
    autonumber
    participant B
    participant R as /api/one-pager/*
    participant S as one_pager_creator_service
    participant DB as DIA Brain
    participant H as one_pager_history_service

    B->>R: POST /extract (files + topic + style + orientation)
    R->>S: extract(...)
    S->>DB: workflow chat ("produce single-page HTML")
    DB-->>S: html
    S-->>R: {html, chatHistoryId}
    R-->>B: 200

    B->>R: POST /refine (chatHistoryId + message)
    R->>S: refine(...)
    S->>DB: workflow chat
    DB-->>S: html
    R-->>B: 200

    B->>R: POST /history (html, meta)
    R->>H: save_generation
    H->>OS: index.json + content.json
    R-->>B: {gen_id}
```

---

## 7. Admin analytics fetch

**What this flow does:** The admin dashboard calls this endpoint to load usage statistics. It fetches many JSON files from the Object Store in parallel (`asyncio.gather` = run all requests at the same time instead of one by one) and returns a combined payload.

```mermaid
sequenceDiagram
    autonumber
    participant B
    participant R as GET /api/admin/analytics
    participant A as analytics_service
    participant OS

    B->>R: GET ?days=28
    R->>R: assert user_info.user in ADMIN_USERS, else 403
    R->>A: get_analytics(days)
    A->>OS: parallel GetObject (asyncio.gather)
    Note over A,OS: clicks/{date}.json × N<br/>users/{date}.json × N<br/>gen_daily/{date}.json × N<br/>gen_failed/{date}.json × N<br/>downloads/{date}.json × N<br/>generations.json<br/>users_total.json<br/>gen_failed_total.json<br/>downloads_total.json
    OS-->>A: results (404s become {})
    A-->>R: aggregated payload
    R-->>B: 200 JSON
```

Missing daily files are normal (no activity that day) and are coerced to empty dicts.

---

## 8. Generic generation/download tracking

**What this flow does:** Every AI generation and every file download increments a counter in the Object Store. These are "fire-and-forget" (`asyncio.create_task`) — the counter runs in the background without making the user wait. If the counter fails, the user is unaffected.

Every generate-style endpoint follows this pattern:

```python
try:
    result = await service.do_thing(...)
    asyncio.create_task(track_generation(app_key))  # fire-and-forget counter
    return JSONResponse(...)
except BrainError as e:
    asyncio.create_task(track_generation_failed(app_key))  # count the failure too
    return JSONResponse(status_code=mapped_status, content=friendly_error)
```

Every download-style endpoint follows:

```python
asyncio.create_task(track_download(app_key))  # fire-and-forget
return StreamingResponse(...)
```

---

## 9. Error propagation across layers

**What this shows:** How an error from the AI service travels through the code layers and reaches the user as a friendly toast notification (never as a raw Python exception).

```
DIA Brain returns an HTTP error
                ↓
common_service maps it to a plain-English message:
  400 → "The request couldn't be processed. Please try again."
  401/403 → "Authentication issue with the AI service."
  404 → "Resource not found."
  413 → "Upload too large."
  429 → "Service is busy. Please retry."
  502/503/504 → "Service temporarily unavailable."
                ↓
The service raises BrainError(status_code, message)
                ↓
The route handler catches BrainError
→ returns JSONResponse({status, message}) with the appropriate HTTP status
                ↓
Browser's Utils.apiRequest() detects the error status
→ calls showToast(message, "error") to show a notification to the user
```

**The contract:** There is no path by which raw Python exception details reach the browser. Internal details are always logged server-side only.
