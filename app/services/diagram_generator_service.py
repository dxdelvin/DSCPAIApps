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
    '- "tree": Hierarchical breakdown, taxonomy, WBS\n\n'
    "RULES:\n"
    "1. Analyze the PDF content thoroughly.\n"
    "2. Suggest 1-4 diagrams depending on content complexity.\n"
    "3. Always include a SUMMARY diagram first that captures the overall picture.\n"
    "4. Add topic-focused diagrams for distinct sections/themes if the content warrants it.\n"
    "5. For each diagram, explain WHY that type was chosen.\n"
    "6. Include the key elements that should appear in each diagram.\n\n"
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
) -> dict:
    """
    Extract text from uploaded PDF files, send to AI for analysis
    to determine optimal diagram types and content.
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

    if not all_text_parts:
        detail = "\n".join(errors) if errors else "No readable text could be extracted from the uploaded files."
        return {
            "error": True,
            "message": "PDF Extraction Failed",
            "detail": detail,
        }

    combined_text = "\n\n".join(all_text_parts)

    prompt = (
        "Below is text content extracted from uploaded PDF documents.\n"
        "Analyze the content and suggest the best diagram types to represent the information.\n"
        "Consider creating a summary diagram plus topic-specific diagrams if warranted.\n\n"
        f"{combined_text}"
    )

    if user_instructions:
        prompt += f"\n\nAdditional user instructions:\n{user_instructions}"

    chat_result = await create_chat_history(brain_id)
    if chat_result.get("error"):
        return chat_result

    chat_history_id = chat_result.get("chatHistoryId")

    response = await call_brain_pure_llm_chat(
        brain_id,
        prompt,
        chat_history_id=chat_history_id,
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
