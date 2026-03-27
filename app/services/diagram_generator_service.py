"""
Diagram Generator Service.
Handles AI-powered draw.io diagram generation from uploaded PDF documents.
Reads PDF content, sends to AI for analysis and diagram generation,
returns draw.io (mxGraph) XML that can be downloaded as .drawio files.
"""
import io
import json
import os
import re
from typing import Optional

from app.services.common_service import (
    create_chat_history,
    call_brain_pure_llm_chat,
    upload_attachments,
)


# ── AI behaviour prompts ──────────────────────────────────

ANALYZE_BEHAVIOUR = (
    "You are a professional diagram architect. "
    "You receive text extracted from PDF documents and must analyze the content "
    "to determine which diagram types would best represent the information.\n\n"
    "AVAILABLE DIAGRAM TYPES:\n"
    '- "flowchart": Process flows, decision trees, step-by-step workflows\n'
    '- "org_chart": Organizational hierarchies, reporting structures\n'
    '- "sequence": Interaction sequences between systems/actors/components\n'
    '- "mind_map": Topic exploration, brainstorming, concept relationships\n'
    '- "er_diagram": Entity relationships, data models, database schemas\n'
    '- "network": Network topology, system architecture, infrastructure\n'
    '- "swimlane": Cross-functional processes with clear role/department separation\n'
    '- "timeline": Chronological events, project milestones, roadmaps\n'
    '- "class_diagram": Object-oriented class structures, inheritance\n'
    '- "state_diagram": State machines, lifecycle stages, transitions\n'
    '- "block_diagram": High-level system components and their connections\n'
    '- "tree": Hierarchical breakdown, taxonomy, WBS\n'
    '- "data_flow": Data flow diagrams, input/output/processing pipelines\n'
    '- "use_case": Use case diagrams, actor-system interactions\n'
    '- "component": Component diagrams, software/system component relationships\n'
    '- "deployment": Deployment diagrams, infrastructure and deployment targets\n'
    '- "activity": Activity diagrams, workflow/activity sequences with concurrency\n'
    '- "venn": Venn diagrams, set overlaps and comparisons\n'
    '- "gantt": Gantt charts, project scheduling and task timelines\n'
    '- "wireframe": Wireframe layouts, UI structure and screen mockups\n\n'
    "RULES:\n"
    "1. Analyze the PDF content thoroughly.\n"
    "2. If the user has specified preferred diagram types, you MUST follow these rules:\n"
    "   a. The MAJORITY of your suggestions MUST use the user's requested type(s).\n"
    "   b. You may include at most 1 alternative diagram of a different type, "
    "ONLY if it clearly adds value. Mark it with '(Best Alternative)' in its name.\n"
    "   c. Focus your analysis on how the content maps to the requested type(s).\n"
    "3. If no preferred types are specified, suggest 1-4 diagrams depending on content complexity.\n"
    "4. For each diagram, explain WHY that type was chosen.\n"
    "5. Include the key elements that should appear in each diagram.\n\n"
    "Return your response as a valid JSON object with this EXACT structure:\n"
    "{\n"
    '  "title": "Overall document title",\n'
    '  "summary": "Brief summary of the document content",\n'
    '  "diagrams": [\n'
    "    {\n"
    '      "name": "Diagram title",\n'
    '      "type": "flowchart",\n'
    '      "reason": "Why this diagram type was chosen",\n'
    '      "key_elements": ["Element 1", "Element 2", ...],\n'
    '      "description": "What this diagram should illustrate"\n'
    "    }\n"
    "  ]\n"
    "}\n\n"
    "IMPORTANT: If the document content does not contain enough meaningful, "
    "structured, or critical information to generate useful diagrams "
    "(e.g. it is too vague, mostly filler text, legal boilerplate with no processes, "
    "or lacks any diagrammable structure), return this EXACT JSON instead:\n"
    "{\n"
    '  "title": "<document title or description>",\n'
    '  "summary": "<Explain clearly WHY no diagrams can be generated from this content>",\n'
    '  "no_useful_content": true,\n'
    '  "diagrams": []\n'
    "}\n\n"
    "Return ONLY the JSON, no markdown fences, no explanation."
)

GENERATE_BEHAVIOUR = (
    "You are an expert diagram generator producing draw.io (mxGraph) XML.\n\n"
    "OUTPUT RULES:\n"
    "1. Output ONLY valid mxGraph XML wrapped in <mxGraphModel> tags.\n"
    "2. Use proper mxCell elements with id, value, style, vertex/edge attributes.\n"
    "3. Every shape must have <mxGeometry> with x, y, width, height.\n"
    "4. Use the 'as=\"geometry\"' attribute on all mxGeometry elements.\n"
    "5. Edges must reference source and target cell IDs.\n"
    "6. Always include root cells: id=\"0\" (root) and id=\"1\" (default parent).\n"
    "7. Use readable, professional styling with colors.\n"
    "8. Space elements properly — no overlapping shapes.\n"
    "9. Use clear, concise labels on all shapes and connections.\n"
    "10. Do NOT wrap in markdown code fences.\n\n"
    "STYLING GUIDELINES:\n"
    "- Use rounded rectangles for process steps: rounded=1;whiteSpace=wrap;\n"
    "- Use diamonds for decisions: rhombus;whiteSpace=wrap;\n"
    "- Use ellipses for start/end: ellipse;whiteSpace=wrap;\n"
    "- Use cylinders for databases: shape=cylinder3;whiteSpace=wrap;\n"
    "- Primary color: #FF5F00 (orange) for key elements\n"
    "- Secondary color: #0F172A (navy) for standard elements\n"
    "- Accent colors: #228BE6 (blue), #10B981 (green), #8B5CF6 (purple)\n"
    "- Background: #FFFFFF for shapes, use strokeColor for borders\n"
    "- Font: fontSize=12; for normal text, fontSize=14; for titles\n\n"
    "Return ONLY the raw mxGraphModel XML. No explanation, no markdown."
)

REFINE_BEHAVIOUR = (
    "You are a diagram editor working with draw.io (mxGraph) XML.\n"
    "The user wants changes to the diagram content or structure.\n"
    "Apply the requested changes and return the FULL updated mxGraphModel XML.\n"
    "Maintain proper draw.io XML structure with mxCell elements.\n"
    "Keep the same professional styling.\n"
    "Return ONLY the raw mxGraphModel XML, no markdown fences, no explanation."
)

COPY_IMAGE_BEHAVIOUR = (
    "You are a diagram reproduction specialist for draw.io (mxGraph) XML.\n"
    "You will receive one or more images.\n\n"
    "STEP 1 — CLASSIFY:\n"
    "Determine if the image contains an actual DIAGRAM: a flowchart, org chart, sequence diagram, "
    "network diagram, mind map, ER diagram, swimlane, block diagram, UML diagram, process map, "
    "architecture diagram, or any structured visual made of shapes connected by arrows/lines.\n"
    "A diagram has geometric shapes (boxes, circles, diamonds, cylinders) connected by arrows "
    "or lines that represent processes, structures, or relationships.\n\n"
    "These are NOT diagrams — return the JSON flag for these:\n"
    "- Plain text documents or screenshots\n"
    "- Bar charts, pie charts, line charts (data visualizations, NOT draw.io diagrams)\n"
    "- Photos or illustrations\n"
    "- Slides or pages with only text and no connecting arrows\n"
    "- Tables without connecting arrows between shapes\n\n"
    "STEP 2A — If the image IS a diagram, reproduce it as draw.io mxGraph XML:\n\n"
    "SHAPES (vertices):\n"
    "- Assign every shape a unique numeric id starting from 2 (ids 0 and 1 are reserved for root cells).\n"
    "- Set vertex=\"1\" on every shape cell.\n"
    "- Match the shape type to the correct draw.io style:\n"
    "    rectangle / process step  → rounded=1;whiteSpace=wrap;html=1;\n"
    "    decision / diamond        → rhombus;whiteSpace=wrap;html=1;\n"
    "    start / end / terminator  → ellipse;whiteSpace=wrap;html=1;\n"
    "    database / cylinder       → shape=cylinder3;whiteSpace=wrap;html=1;\n"
    "    parallelogram / input     → shape=parallelogram;whiteSpace=wrap;html=1;\n"
    "    document shape            → shape=document;whiteSpace=wrap;html=1;\n"
    "    cloud                     → ellipse;shape=cloud;whiteSpace=wrap;html=1;\n"
    "    hexagon                   → shape=hexagon;whiteSpace=wrap;html=1;\n"
    "    circle / oval             → ellipse;whiteSpace=wrap;html=1;\n"
    "- Copy the label text exactly as it appears in the image.\n"
    "- Set x, y, width, height in <mxGeometry> to reflect the relative layout.\n\n"
    "CONNECTIONS (edges) — THIS IS THE MOST IMPORTANT PART:\n"
    "- Every visible arrow, line, or connector in the image MUST become an mxCell with edge=\"1\".\n"
    "- Each edge cell MUST have source=\"<id>\" and target=\"<id>\" referencing the correct shape ids.\n"
    "- Copy edge labels (e.g. 'Yes', 'No', conditions) into the value attribute.\n"
    "- For directed arrows use: style=\"edgeStyle=orthogonalEdgeStyle;html=1;\"\n"
    "- For bidirectional arrows add: endArrow=block;startArrow=block;\n"
    "- For dashed lines add: dashed=1;\n"
    "- DO NOT OMIT A SINGLE CONNECTION. Every arrow in the image needs a corresponding edge cell.\n\n"
    "XML STRUCTURE RULES:\n"
    "1. Output ONLY valid mxGraph XML wrapped in <mxGraphModel> tags.\n"
    "2. Always include root cells id=\"0\" (root) and id=\"1\" (default parent layer).\n"
    "3. All vertex and edge cells must be children of the cell with id=\"1\".\n"
    "4. Every <mxGeometry> element must have the attribute as=\"geometry\".\n"
    "5. Vertices need: <mxGeometry x=\"...\" y=\"...\" width=\"...\" height=\"...\" as=\"geometry\" />\n"
    "6. Edges need: <mxGeometry relative=\"1\" as=\"geometry\" />\n"
    "7. Use readable, professional colors that match the source image as closely as possible.\n"
    "8. Space shapes so nothing overlaps — minimum 40px gap between shapes.\n"
    "9. Do NOT wrap output in markdown code fences.\n\n"
    "STEP 2B — If the image is NOT a diagram:\n"
    "Return ONLY this exact JSON (no markdown wrapper, no extra text):\n"
    '{"not_a_diagram": true, "content_type": "<brief description of what the image actually shows>", '
    '"suggestion": "Use Analyze Content mode to let AI generate diagram suggestions from this content."}\n\n'
    "Return ONLY the raw mxGraphModel XML for diagrams. No explanation, no markdown."
)


# ─── PDF text extraction ─────────────────────────────────

def _extract_pdf_text(pdf_bytes: bytes) -> tuple[str | None, str | None]:
    """Extract text from a PDF file using PyPDF2.
    
    Returns (text, error). On success error is None; on failure text is None.
    """
    try:
        from PyPDF2 import PdfReader
        reader = PdfReader(io.BytesIO(pdf_bytes))
        pages: list[str] = []
        has_content = False
        for i, page in enumerate(reader.pages, 1):
            text = page.extract_text() or ""
            text = text.strip()
            if text:
                pages.append(f"--- Page {i} ---\n{text}")
                has_content = True
            else:
                pages.append(f"--- Page {i} ---\n(No extractable text)")
        if not has_content:
            return None, "No readable text found in the PDF. The file may be image-based or scanned."
        full_text = "\n\n".join(pages)
        full_text = re.sub(r'(--|#|\/\*|\*\/)', ' ', full_text)
        full_text = re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]', '', full_text)
        # Limit to first 90K characters
        if len(full_text) > 90000:
            full_text = full_text[:90000] + "\n\n[Content truncated at 90K characters. Only first portion processed.]"
        # Check if meaningful content was extracted
        clean = re.sub(r'---\s*Page\s*\d+\s*---', '', full_text)
        clean = re.sub(r'\(No extractable text\)', '', clean).strip()
        if len(clean) < 80:
            return None, (
                "The PDF appears to be image-based or scanned. "
                "Only minimal text could be extracted (less than 80 characters). "
                "Please use a text-based PDF for best results."
            )
        return full_text, None
    except ImportError:
        return None, "PDF processing library (PyPDF2) is not installed on the server."
    except Exception as e:
        return None, f"PDF text extraction failed: {str(e)}"


# ─── JSON parsing ────────────────────────────────────────

def _parse_json_response(text: str) -> dict:
    """Try to parse a JSON object from the AI response."""
    cleaned = re.sub(r"```(?:json)?", "", text).strip().rstrip("`").strip()

    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        pass

    match = re.search(r"\{.*\}", cleaned, re.DOTALL)
    if match:
        try:
            return json.loads(match.group())
        except json.JSONDecodeError:
            pass

    return {}


# ─── mxGraph XML extraction ─────────────────────────────

def _extract_mxgraph_xml(text: str) -> str:
    """Extract mxGraphModel XML from the AI response."""
    # Remove markdown fences
    cleaned = re.sub(r"```(?:xml)?", "", text).strip().rstrip("`").strip()

    # Try to find <mxGraphModel>...</mxGraphModel>
    pattern = r"(<mxGraphModel[\s\S]*?</mxGraphModel>)"
    match = re.search(pattern, cleaned, re.DOTALL | re.IGNORECASE)
    if match:
        return match.group(1).strip()

    return cleaned.strip()


def _build_drawio_file(diagrams: list[dict]) -> str:
    """Wrap one or more mxGraphModel XML blocks into a complete .drawio file."""
    parts = ['<mxfile>']
    for i, diag in enumerate(diagrams):
        name = diag.get("name", f"Diagram {i + 1}")
        xml = diag.get("xml", "")
        # Escape the name for XML attribute
        safe_name = name.replace("&", "&amp;").replace('"', "&quot;").replace("<", "&lt;").replace(">", "&gt;")
        parts.append(f'  <diagram name="{safe_name}">')
        parts.append(f'    {xml}')
        parts.append('  </diagram>')
    parts.append('</mxfile>')
    return "\n".join(parts)


# ─── Public API ─────────────────────────────────────────────

async def analyze_pdf_content(
    pdf_bytes_list: list[tuple[str, bytes]],
    user_instructions: str = "",
    image_files: list = None,
) -> dict:
    """
    Extract text from uploaded PDFs and/or process uploaded images via AI vision,
    then analyze content to determine optimal diagram types.
    Returns dict with 'analysis' (parsed JSON), 'chatHistoryId', 'extractedText', or 'error'.
    """
    brain_id = os.getenv("DSCP_BRAIN_ID")
    if not brain_id:
        return {"error": True, "message": "API Not Active", "detail": "DSCP_BRAIN_ID is not configured."}

    all_text_parts: list[str] = []
    errors: list[str] = []
    for fname, fbytes in pdf_bytes_list:
        text, err = _extract_pdf_text(fbytes)
        if err:
            errors.append(f"{fname}: {err}")
        elif text:
            all_text_parts.append(f"=== File: {fname} ===\n{text}")

    has_text = bool(all_text_parts)
    has_images = bool(image_files)

    if not has_text and not has_images:
        detail = "\n".join(errors) if errors else "No readable content could be extracted from the uploaded files."
        return {
            "error": True,
            "message": "Extraction Failed",
            "detail": detail,
        }

    combined_text = "\n\n".join(all_text_parts) if has_text else ""

    if has_text:
        prompt = (
            "Below is text content extracted from uploaded documents.\n"
            "Analyze the content and suggest the best diagram types to represent the information.\n"
            "Consider creating a summary diagram plus topic-specific diagrams if warranted.\n\n"
            f"{combined_text}"
        )
    else:
        prompt = (
            "Analyze the uploaded image(s) and suggest the best diagram types to represent the information shown.\n"
            "Consider creating a summary diagram plus topic-specific diagrams if warranted."
        )

    if user_instructions:
        prompt += f"\n\nAdditional user instructions:\n{user_instructions}"

    chat_result = await create_chat_history(brain_id)
    if chat_result.get("error"):
        return chat_result

    chat_history_id = chat_result.get("chatHistoryId")

    attachment_ids = []
    if has_images:
        upload_result = await upload_attachments(brain_id, image_files)
        if upload_result.get("error"):
            return upload_result
        attachment_ids = upload_result.get("attachmentIds", [])

    response = await call_brain_pure_llm_chat(
        brain_id,
        prompt,
        chat_history_id=chat_history_id,
        attachment_ids=attachment_ids or None,
        custom_behaviour=ANALYZE_BEHAVIOUR,
    )

    if response.get("error"):
        return response

    raw = response.get("result", "")
    parsed = _parse_json_response(raw)

    if not parsed or "diagrams" not in parsed:
        return {
            "error": True,
            "message": "Could not parse AI response",
            "detail": "The AI did not return valid diagram analysis JSON.",
            "raw": raw,
        }

    # AI explicitly flagged no useful content
    if parsed.get("no_useful_content") or not parsed.get("diagrams"):
        return {
            "error": True,
            "message": "No Diagrammable Content Found",
            "detail": parsed.get("summary", "The document does not contain enough structured or critical information to generate meaningful diagrams."),
            "title": parsed.get("title", ""),
        }

    return {
        "analysis": parsed,
        "chatHistoryId": response.get("chatHistoryId", chat_history_id),
        "extractedText": combined_text,
    }


async def generate_diagrams(
    chat_history_id: str,
    analysis: dict,
    extracted_text: str,
    selected_indices: list[int] | None = None,
) -> dict:
    """
    Generate draw.io XML for each selected diagram from the analysis.
    Returns dict with 'diagrams' list (each with name, type, xml), 'chatHistoryId', or 'error'.
    """
    brain_id = os.getenv("DSCP_BRAIN_ID")
    if not brain_id:
        return {"error": True, "message": "API Not Active", "detail": "DSCP_BRAIN_ID is not configured."}

    all_diagrams = analysis.get("diagrams", [])
    if selected_indices is not None:
        selected = [all_diagrams[i] for i in selected_indices if 0 <= i < len(all_diagrams)]
    else:
        selected = all_diagrams

    if not selected:
        return {"error": True, "message": "No diagrams selected", "detail": "Please select at least one diagram to generate."}

    generated: list[dict] = []

    for diag in selected:
        diag_name = diag.get("name", "Diagram")
        diag_type = diag.get("type", "flowchart")
        diag_desc = diag.get("description", "")
        key_elements = diag.get("key_elements", [])

        prompt = (
            f"Generate a {diag_type} diagram in draw.io (mxGraph XML) format.\n\n"
            f"Diagram title: {diag_name}\n"
            f"Description: {diag_desc}\n"
            f"Key elements to include: {', '.join(key_elements)}\n\n"
            f"Source content for reference:\n{extracted_text[:20000]}\n\n"
            "Generate the complete mxGraphModel XML for this diagram. "
            "Make it professional, well-spaced, and visually clear."
        )

        response = await call_brain_pure_llm_chat(
            brain_id,
            prompt,
            chat_history_id=chat_history_id,
            custom_behaviour=GENERATE_BEHAVIOUR,
        )

        if response.get("error"):
            generated.append({
                "name": diag_name,
                "type": diag_type,
                "xml": "",
                "error": response.get("detail", "Generation failed"),
            })
            continue

        chat_history_id = response.get("chatHistoryId", chat_history_id)
        raw_xml = _extract_mxgraph_xml(response.get("result", ""))

        generated.append({
            "name": diag_name,
            "type": diag_type,
            "xml": raw_xml,
        })

    return {
        "diagrams": generated,
        "chatHistoryId": chat_history_id,
    }


async def refine_diagram(
    chat_history_id: str,
    message: str,
    current_xml: str = "",
    diagram_name: str = "",
) -> dict:
    """Refine a specific diagram based on user feedback."""
    brain_id = os.getenv("DSCP_BRAIN_ID")
    if not brain_id:
        return {"error": True, "message": "API Not Active", "detail": "DSCP_BRAIN_ID is not configured."}

    prompt = message
    if current_xml:
        prompt = (
            f"Here is the current draw.io (mxGraphModel) XML for the diagram \"{diagram_name}\":\n"
            f"{current_xml}\n\n"
            f"User request: {message}\n\n"
            "Apply the changes and return the FULL updated mxGraphModel XML."
        )

    response = await call_brain_pure_llm_chat(
        brain_id,
        prompt,
        chat_history_id=chat_history_id,
        custom_behaviour=REFINE_BEHAVIOUR,
    )

    if response.get("error"):
        return response

    raw = response.get("result", "")
    xml = _extract_mxgraph_xml(raw)

    return {
        "xml": xml,
        "chatHistoryId": response.get("chatHistoryId", chat_history_id),
    }


def build_drawio_download(diagrams: list[dict]) -> str:
    """Build a complete .drawio file content from generated diagrams."""
    return _build_drawio_file(diagrams)


async def copy_image_as_diagram(image_files: list) -> dict:
    """
    Reproduce image(s) as an exact draw.io diagram using AI vision.

    Accepts a list of UploadFile objects (images only — no PDFs).
    Returns one of:
      - {"diagrams": [...], "chatHistoryId": ...}           on success
      - {"not_a_diagram": True, "content_type": ..., ...}   when image is not a diagram
      - {"error": True, "message": ..., "detail": ...}      on failure
    """
    brain_id = os.getenv("DSCP_BRAIN_ID")
    if not brain_id:
        return {"error": True, "message": "API Not Active", "detail": "DSCP_BRAIN_ID environment variable is not configured."}

    if not image_files:
        return {"error": True, "message": "No images provided", "detail": "Please upload at least one image file."}

    chat_result = await create_chat_history(brain_id)
    if chat_result.get("error"):
        return {"error": True, "message": "Session error", "detail": chat_result.get("detail", "Could not create chat session.")}

    chat_history_id = chat_result.get("chatHistoryId")

    upload_result = await upload_attachments(brain_id, image_files)
    if upload_result.get("error"):
        return upload_result
    attachment_ids = upload_result.get("attachmentIds", [])

    n = len(image_files)
    prompt = (
        f"I have uploaded {n} image{'s' if n > 1 else ''}. "
        "Please examine the image carefully. "
        "If it shows a diagram, reproduce it exactly as mxGraph XML. "
        "If it does not show a diagram, return the JSON flag as described in your behaviour rules."
    )

    response = await call_brain_pure_llm_chat(
        brain_id,
        prompt,
        chat_history_id=chat_history_id,
        attachment_ids=attachment_ids or None,
        custom_behaviour=COPY_IMAGE_BEHAVIOUR,
    )

    if response.get("error"):
        return {
            "error": True,
            "message": response.get("message", "AI service error"),
            "detail": response.get("detail", "The AI could not process the image."),
        }

    raw = response.get("result", "")
    updated_chat_id = response.get("chatHistoryId", chat_history_id)

    # Check for the not_a_diagram JSON flag — try direct parse first
    cleaned = re.sub(r"```(?:json)?", "", raw).strip().rstrip("`").strip()
    try:
        parsed = json.loads(cleaned)
        if parsed.get("not_a_diagram"):
            return {
                "not_a_diagram": True,
                "content_type": parsed.get("content_type", "non-diagram content"),
                "suggestion": parsed.get("suggestion", "Use Analyze Content mode."),
                "chatHistoryId": updated_chat_id,
            }
    except (json.JSONDecodeError, AttributeError):
        pass

    # Try to find the JSON flag embedded anywhere in the response
    match = re.search(r'\{"not_a_diagram"\s*:\s*true[^}]*\}', raw, re.DOTALL)
    if match:
        try:
            parsed = json.loads(match.group(0))
            if parsed.get("not_a_diagram"):
                return {
                    "not_a_diagram": True,
                    "content_type": parsed.get("content_type", "non-diagram content"),
                    "suggestion": parsed.get("suggestion", "Use Analyze Content mode."),
                    "chatHistoryId": updated_chat_id,
                }
        except json.JSONDecodeError:
            pass

    # Extract mxGraphModel XML
    xml = _extract_mxgraph_xml(raw)
    if not xml or "<mxGraphModel" not in xml:
        return {
            "error": True,
            "message": "No diagram XML produced",
            "detail": "The AI could not reproduce a structured diagram from the image. The image may not contain a clear draw.io-compatible diagram.",
        }

    file_names = [getattr(f, "filename", f"Image {i + 1}") for i, f in enumerate(image_files)]
    raw_name = file_names[0].rsplit(".", 1)[0] if file_names else "Copied Diagram"

    return {
        "diagrams": [{"name": raw_name, "type": "copy", "xml": xml}],
        "chatHistoryId": updated_chat_id,
    }
