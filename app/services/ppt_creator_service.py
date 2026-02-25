"""
PPT Creator Service.
Handles AI-powered PowerPoint generation from uploaded presentations.
Uses Brain workflow to extract & synthesize content, then builds
a new .pptx via python-pptx with the project template.
"""
import io
import json
import os
import re
from typing import List, Optional

from pptx import Presentation
from pptx.util import Inches, Pt, Emu
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR

from app.services.common_service import (
    create_chat_history,
    upload_attachments,
    call_brain_workflow_chat,
)

# Re-use Signavio workflow for now
SIGNAVIO_WORKFLOW_ID = "BW10nzxLhlqO"

TEMPLATE_PATH = os.path.join(
    os.path.dirname(__file__), "..", "static", "docs", "pptTemplate.potx"
)

# ── Brand colours ──────────────────────────────────────────
BSH_ORANGE = RGBColor(0xFF, 0x5F, 0x00)
BSH_NAVY   = RGBColor(0x0F, 0x17, 0x2A)
BSH_WHITE  = RGBColor(0xFF, 0xFF, 0xFF)
BSH_GREY   = RGBColor(0x64, 0x74, 0x8B)

# ── AI behaviour prompts ──────────────────────────────────
EXTRACT_BEHAVIOUR = (
    "You are a PowerPoint content analyst. "
    "Analyze the uploaded PowerPoint files and extract all relevant content. "
    "Return your response as a valid JSON object with this exact structure:\n"
    '{\n'
    '  "title": "Presentation Title",\n'
    '  "subtitle": "Short subtitle or tagline",\n'
    '  "slides": [\n'
    '    {\n'
    '      "title": "Slide Title",\n'
    '      "bullets": ["Point 1", "Point 2", "Point 3"],\n'
    '      "notes": "Optional speaker notes"\n'
    '    }\n'
    '  ]\n'
    '}\n'
    "Combine and de-duplicate content from all files. "
    "Create a logical flow. Keep bullet points concise. "
    "Return ONLY the JSON, no markdown fences, no explanation."
)

REFINE_BEHAVIOUR = (
    "You are a PowerPoint content editor. "
    "The user wants changes to the presentation content. "
    "Apply the requested changes and return the FULL updated JSON "
    "with the same structure (title, subtitle, slides array). "
    "Return ONLY the JSON, no markdown fences, no explanation."
)


def _extract_text_from_pptx(file_bytes: bytes) -> str:
    """Pull all text from a .pptx file for prompt context."""
    prs = Presentation(io.BytesIO(file_bytes))
    parts: list[str] = []
    for i, slide in enumerate(prs.slides, 1):
        texts: list[str] = []
        for shape in slide.shapes:
            if shape.has_text_frame:
                for para in shape.text_frame.paragraphs:
                    t = para.text.strip()
                    if t:
                        texts.append(t)
        if texts:
            parts.append(f"--- Slide {i} ---\n" + "\n".join(texts))
    return "\n\n".join(parts)


def _parse_json_response(text: str) -> dict:
    """Try to parse a JSON object from the AI response."""
    # Strip markdown fences if present
    cleaned = re.sub(r"```(?:json)?", "", text).strip().rstrip("`").strip()

    # Try direct parse
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        pass

    # Try finding a JSON object in the text
    match = re.search(r"\{.*\}", cleaned, re.DOTALL)
    if match:
        try:
            return json.loads(match.group())
        except json.JSONDecodeError:
            pass

    return {}


def _build_pptx(content: dict) -> io.BytesIO:
    """Build a .pptx from structured content dict using the project template."""
    # Try to use the template; fall back to blank if missing
    if os.path.exists(TEMPLATE_PATH):
        prs = Presentation(TEMPLATE_PATH)
    else:
        prs = Presentation()
        prs.slide_width = Inches(13.333)
        prs.slide_height = Inches(7.5)

    slides_data = content.get("slides", [])
    pres_title = content.get("title", "AI Generated Presentation")
    pres_subtitle = content.get("subtitle", "")

    # ── Title slide ──────────────────────────────────────
    title_layout = prs.slide_layouts[0]  # typically the title layout
    title_slide = prs.slides.add_slide(title_layout)

    # Try to populate placeholders; fall back to shapes
    try:
        title_slide.placeholders[0].text = pres_title
        if len(title_slide.placeholders) > 1:
            title_slide.placeholders[1].text = pres_subtitle
    except (KeyError, IndexError):
        _add_textbox(title_slide, pres_title, Inches(1), Inches(2.5), Inches(11), Inches(1.5), Pt(36), True, BSH_NAVY)
        if pres_subtitle:
            _add_textbox(title_slide, pres_subtitle, Inches(1), Inches(4.2), Inches(11), Inches(1), Pt(20), False, BSH_GREY)

    # ── Content slides ───────────────────────────────────
    # Pick a content layout (index 1 is usually "Title + Content")
    content_layout_idx = min(1, len(prs.slide_layouts) - 1)
    content_layout = prs.slide_layouts[content_layout_idx]

    for slide_data in slides_data:
        slide = prs.slides.add_slide(content_layout)
        slide_title = slide_data.get("title", "")
        bullets = slide_data.get("bullets", [])
        notes_text = slide_data.get("notes", "")

        # Title
        try:
            slide.placeholders[0].text = slide_title
        except (KeyError, IndexError):
            _add_textbox(slide, slide_title, Inches(0.8), Inches(0.4), Inches(11.5), Inches(1), Pt(28), True, BSH_NAVY)

        # Bullets
        try:
            body = slide.placeholders[1]
            tf = body.text_frame
            tf.clear()
            for j, bullet in enumerate(bullets):
                if j == 0:
                    tf.paragraphs[0].text = bullet
                    _style_para(tf.paragraphs[0], Pt(18), BSH_NAVY)
                else:
                    p = tf.add_paragraph()
                    p.text = bullet
                    _style_para(p, Pt(18), BSH_NAVY)
        except (KeyError, IndexError):
            y = Inches(1.6)
            for bullet in bullets:
                _add_textbox(slide, f"• {bullet}", Inches(1), y, Inches(11), Inches(0.5), Pt(16), False, BSH_NAVY)
                y += Inches(0.55)

        # Speaker notes
        if notes_text:
            slide.notes_slide.notes_text_frame.text = notes_text

    buf = io.BytesIO()
    prs.save(buf)
    buf.seek(0)
    return buf


def _add_textbox(slide, text, left, top, width, height, font_size, bold, color):
    """Add a simple textbox to a slide."""
    txBox = slide.shapes.add_textbox(left, top, width, height)
    tf = txBox.text_frame
    tf.word_wrap = True
    p = tf.paragraphs[0]
    p.text = text
    _style_para(p, font_size, color, bold)


def _style_para(para, size, color, bold=False):
    """Apply font styling to a paragraph."""
    for run in para.runs:
        run.font.size = size
        run.font.color.rgb = color
        run.font.bold = bold


# ── Public API ─────────────────────────────────────────────

async def extract_ppt_content(file_bytes_list: list[tuple[str, bytes]], user_instructions: str = "") -> dict:
    """
    Upload PPT files to Brain, ask it to extract & structure the content.
    Returns dict with 'content' (parsed JSON), 'chatHistoryId', or 'error'.
    """
    brain_id = os.getenv("SIGNAVIO_BRAIN_ID")
    if not brain_id:
        return {"error": True, "message": "API Not Active", "detail": "SIGNAVIO_BRAIN_ID is not configured."}

    # Build text context from all files
    all_text_parts: list[str] = []
    for fname, fbytes in file_bytes_list:
        try:
            text = _extract_text_from_pptx(fbytes)
            all_text_parts.append(f"=== File: {fname} ===\n{text}")
        except Exception:
            all_text_parts.append(f"=== File: {fname} === (could not extract text)")

    combined_text = "\n\n".join(all_text_parts)

    prompt = (
        "Below is the text content extracted from the uploaded PowerPoint files.\n"
        "Analyze all content, combine related topics, remove duplicates, and produce "
        "a clean, structured JSON for a new presentation.\n\n"
        f"{combined_text}"
    )

    if user_instructions:
        prompt += f"\n\nAdditional user instructions:\n{user_instructions}"

    # Create chat history for ongoing conversation
    chat_result = await create_chat_history(brain_id)
    if chat_result.get("error"):
        return chat_result

    chat_history_id = chat_result.get("chatHistoryId")

    response = await call_brain_workflow_chat(
        brain_id,
        prompt,
        chat_history_id=chat_history_id,
        custom_behaviour=EXTRACT_BEHAVIOUR,
        workflow_id=SIGNAVIO_WORKFLOW_ID,
    )

    if response.get("error"):
        return response

    raw = response.get("result", "")
    parsed = _parse_json_response(raw)

    if not parsed or "slides" not in parsed:
        return {
            "error": True,
            "message": "Could not parse AI response",
            "detail": "The AI did not return valid slide JSON.",
            "raw": raw,
        }

    return {
        "content": parsed,
        "chatHistoryId": response.get("chatHistoryId", chat_history_id),
    }


async def refine_ppt_content(chat_history_id: str, message: str, current_content: dict = None) -> dict:
    """Continue the conversation to refine the presentation content."""
    brain_id = os.getenv("SIGNAVIO_BRAIN_ID")
    if not brain_id:
        return {"error": True, "message": "API Not Active", "detail": "SIGNAVIO_BRAIN_ID is not configured."}

    prompt = message
    if current_content:
        prompt = (
            f"Here is the current presentation JSON:\n{json.dumps(current_content, indent=2)}\n\n"
            f"User request: {message}\n\n"
            "Apply the changes and return the FULL updated JSON."
        )

    response = await call_brain_workflow_chat(
        brain_id,
        prompt,
        chat_history_id=chat_history_id,
        custom_behaviour=REFINE_BEHAVIOUR,
        workflow_id=SIGNAVIO_WORKFLOW_ID,
    )

    if response.get("error"):
        return response

    raw = response.get("result", "")
    parsed = _parse_json_response(raw)

    if not parsed or "slides" not in parsed:
        # Return the raw text so the UI can show it
        return {
            "result": raw,
            "chatHistoryId": response.get("chatHistoryId", chat_history_id),
        }

    return {
        "content": parsed,
        "chatHistoryId": response.get("chatHistoryId", chat_history_id),
    }


def generate_pptx_file(content: dict) -> io.BytesIO:
    """Generate a .pptx file from structured content dict. Returns BytesIO buffer."""
    return _build_pptx(content)
