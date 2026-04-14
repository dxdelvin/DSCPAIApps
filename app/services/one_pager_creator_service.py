"""
One Pager Creator Service.
AI generates a complete, self-contained HTML/CSS document for a single-page
one-pager. The HTML is previewed in an iframe and converted to PDF
server-side using Playwright (headless Chromium) for accurate rendering.
"""
import os
import re
from typing import Optional

from app.services.common_service import (
    create_chat_history,
    call_brain_pure_llm_chat,
    upload_attachments,
    extract_pdf_text,
    sanitize_filename_for_prompt,
)

TEMPLATE_STYLES = {
    "cheatsheet": {
        "label": "Cheatsheet",
        "description": "Dense 3-column reference layout, A4 landscape - compact, scannable, many short sections.",
        "orientation": "landscape",
    },
    "flyer": {
        "label": "Flyer",
        "description": "Eye-catching hero header with bold CTA strip at the bottom, A4 portrait.",
        "orientation": "portrait",
    },
    "executive_summary": {
        "label": "Executive Summary",
        "description": "Professional 2-column layout with a key-metrics row, A4 portrait.",
        "orientation": "portrait",
    },
    "infographic": {
        "label": "Infographic",
        "description": "Visual-first - numbered sections, large stat boxes, icon-led bullets, A4 portrait.",
        "orientation": "portrait",
    },
}

_COMMON_PRINT_RULES = """
Return ONLY raw HTML starting with <!DOCTYPE html> and ending with </html>. No markdown, no explanation.
All CSS in a single <style> tag.
Include in body: -webkit-print-color-adjust: exact; print-color-adjust: exact;
Everything must fit on one A4 page in print.
LIGHT MODE ONLY: white or very light background with dark readable text. Never use dark/black backgrounds.
Do not generate dark mode, neon themes, or low-contrast color combinations.
Use CSS variables in :root for colors, spacing, and radius tokens.
Avoid generic template look: create clear visual hierarchy, intentional spacing rhythm, and section-specific styling.
Prefer practical typography pairings available on most systems (for example: Segoe UI, Georgia, Trebuchet MS, Verdana).
Keep the design polished, modern, and business-credible while still visually distinct.

IMAGE RULES (CRITICAL - NO EXCEPTIONS):
- NEVER include <img> tags with external URLs (http://, https://, imgur, unsplash, cdnjs, etc.).
- NEVER embed stock photos, placeholder images, or icons from the internet.
- If the user provided images as attachments and they add direct value to the layout, you may reference them with a placeholder like <img src="user-image-1" alt="..."> — but only if truly useful.
- If no user images were provided, use pure CSS shapes, colored divs, or text-based layouts instead.
- Decorate layouts with CSS gradients, borders, and color blocks — never external images.

CONTENT RULES (CRITICAL):
- Use ONLY the information provided in the source material, topic, key points, and user context.
- NEVER invent company names, project names, people, statistics, KPIs, dates, or any other facts.
- NEVER use placeholder or example data like "QuantumLeap", "Acme Corp", "Project Synapse", "John Doe", etc.
- If the source material lacks a company name or specific detail, leave it generic (e.g. just use a section heading) rather than fabricating one.
- Every number, name, and claim in the output must come directly from the provided content."""

TEMPLATE_BEHAVIOURS = {
    "cheatsheet": """You are a creative print designer. Create a beautiful CHEATSHEET one-pager.

Vibe: dense, scannable, real-world quick reference card used by professionals.
Layout: A4 landscape with a disciplined 3-column grid and balanced gutters.
Style: compact but readable body text, high-contrast heading chips, subtle separators, and practical icon-free visual cues.
Quality bar: this must look like a real operations handout, not a demo template.
Content behavior: prioritize short actionable bullets, checklists, and command-style snippets.

""" + _COMMON_PRINT_RULES,

    "flyer": """You are a creative print designer. Create a stunning PROMOTIONAL FLYER one-pager.

Vibe: bold and premium, like a real campaign flyer prepared by a design agency.
Layout: A4 portrait with a strong hero band, one focal message, supporting proof points, and a clear CTA zone.
Style: expressive headline typography, controlled accent usage, large readable sections, and visual momentum from top to bottom.
Quality bar: avoid generic gradients and random blobs; every visual block should support the message.
Content behavior: concise persuasive copy with concrete benefits and outcomes.
Hero area: use a CSS gradient or solid color block for the hero background — NEVER an external image URL.
Background: use a light base (white or very light tint) for the overall page; reserve bold color only for hero bands or accent strips.

""" + _COMMON_PRINT_RULES,

    "executive_summary": """You are a creative business document designer. Create a polished EXECUTIVE SUMMARY one-pager.

Vibe: board-ready, data-led, and high trust.
Layout: A4 portrait with branded header, KPI strip, two-column narrative, and a crisp conclusion zone.
Style: restrained but premium, clear typographic hierarchy, strong alignment, and subtle but intentional accents.
Quality bar: this should look like a consultant-grade brief, not a generic AI report.
Content behavior: concise claims backed by concrete numbers, milestones, risks, and next steps.

""" + _COMMON_PRINT_RULES,

    "infographic": """You are a creative infographic designer. Create a visually striking INFOGRAPHIC one-pager.

Vibe: visual-first narrative with clarity and momentum.
Layout: A4 portrait with an obvious reading path, large data callouts, and numbered blocks that guide the eye.
Style: bold numeric hierarchy, strong contrast between data and explanation, and controlled accent colors.
Quality bar: avoid clipart-like styling and novelty effects; prioritize clarity and credibility.
Content behavior: every visual block should communicate one clear fact or step.

""" + _COMMON_PRINT_RULES,
}

EXTRACT_BEHAVIOUR = TEMPLATE_BEHAVIOURS["executive_summary"]
REFINE_BEHAVIOUR = """You are an expert document designer. Modify the provided one-pager HTML document according to the user's request.

RULES:
- Return ONLY the complete updated HTML - start with <!DOCTYPE html>, end with </html>
- No markdown fences, no explanation - raw HTML only
- Preserve the template layout, visual design quality, and print readiness of the original
- Apply the user's changes precisely: content edits, color changes, section additions/removals, tone adjustments
- Maintain the single-page A4 constraint - if content grows, make text more concise rather than overflowing
- Keep output in light mode unless the user explicitly asks for dark mode
- Improve weak/generic sections when refining; do not return flat boilerplate design
- NEVER add <img> tags with external URLs (http://, https://, imgur, unsplash, etc.) — use CSS shapes and color blocks instead"""


def _strip_external_images(html: str) -> str:
    """Remove any <img> tags whose src points to an external URL."""
    return re.sub(
        r'<img\b[^>]*\bsrc=["\'][^"\'>]*(?:http|//)[^"\'>]*["\'][^>]*/?>', 
        '', 
        html, 
        flags=re.IGNORECASE
    )


def _extract_html_response(text: str) -> str:
    """Strip markdown fences and extract clean HTML from AI response."""
    text = text.strip()
    text = re.sub(r"^```(?:html)?\s*\n?", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\n?```\s*$", "", text.strip())
    text = text.strip()
    lower = text.lower()
    for marker in ("<!doctype", "<html"):
        idx = lower.find(marker)
        if idx > 0:
            text = text[idx:]
            break
    return _strip_external_images(text)


async def extract_one_pager_content(
    pdf_bytes_list: list[tuple[str, bytes]],
    topic: str = "",
    key_points: str = "",
    audience: str = "",
    purpose: str = "",
    template_style: str = "executive_summary",
    image_files: list = None,
) -> dict:
    """Generate a complete one-pager HTML document from source material and user context.

    Returns dict with 'html' (complete HTML string) and 'chatHistoryId'.
    """
    brain_id = os.getenv("BPMN_CHECKER_BRAIN_ID") or os.getenv("SIGNAVIO_BRAIN_ID")
    if not brain_id:
        return {"error": True, "message": "API Not Active", "detail": "BPMN_CHECKER_BRAIN_ID is not configured."}

    all_text_parts: list[str] = []
    errors: list[str] = []
    for fname, fbytes in pdf_bytes_list:
        safe_name = sanitize_filename_for_prompt(fname)
        text, err = extract_pdf_text(fbytes)
        if err:
            errors.append(f"{safe_name}: {err}")
        elif text:
            all_text_parts.append(f"=== File: {safe_name} ===\n{text}")

    has_text = bool(all_text_parts)
    has_images = bool(image_files)
    has_user_context = bool(topic or key_points or audience or purpose)

    if not has_text and not has_images and not has_user_context:
        detail = "\n".join(errors) if errors else "No content provided. Upload files or fill in the topic fields."
        return {"error": True, "message": "No Content", "detail": detail}

    if has_text and not has_user_context:
        combined_raw = " ".join(all_text_parts)
        word_count = len(combined_raw.split())
        if word_count < 40:
            return {
                "error": True,
                "message": "Insufficient Content",
                "detail": (
                    "The uploaded document(s) contain very little usable text "
                    f"({word_count} words). Please upload a document with more "
                    "meaningful content, or fill in the Topic and Key Points "
                    "fields to give the AI enough context to work with."
                ),
            }

    if not has_text and has_images and not has_user_context:
        return {
            "error": True,
            "message": "Not Enough Context",
            "detail": (
                "Images alone may not provide enough information for a quality one-pager. "
                "Please also fill in the Topic, Key Points, or Purpose fields so the AI "
                "knows what to focus on."
            ),
        }

    if pdf_bytes_list and not has_text and not has_images:
        file_errors = "\n".join(errors) if errors else "Could not extract text from the uploaded files."
        if has_user_context:
            pass
        else:
            return {
                "error": True,
                "message": "Unreadable Documents",
                "detail": (
                    f"{file_errors}\n\n"
                    "None of the uploaded PDFs contained usable text. Please upload "
                    "text-based PDFs or fill in the Topic and Key Points fields instead."
                ),
            }

    style_info = TEMPLATE_STYLES.get(template_style, TEMPLATE_STYLES["executive_summary"])

    prompt_parts = [
        f"STYLE: {template_style} - {style_info['description']}",
        "QUALITY BAR: Build a realistic, designer-quality, light-mode document that feels production-ready, not a generic AI template.",
        "STRICT: Use ONLY the actual content from the provided source material below. Do NOT invent any company names, project names, statistics, KPIs, people, or dates. Every piece of text in the one-pager must come from the user's input or uploaded documents.",

    ]
    if topic:
        prompt_parts.append(f"TOPIC: {topic}")
    if audience:
        prompt_parts.append(f"TARGET AUDIENCE: {audience}")
    if purpose:
        prompt_parts.append(f"PURPOSE: {purpose}")
    if key_points:
        prompt_parts.append(f"KEY POINTS TO HIGHLIGHT:\n{key_points}")

    if has_text:
        combined = "\n\n".join(all_text_parts)
        prompt_parts.append(
            "SOURCE MATERIAL (from uploaded documents - use ONLY this content, do NOT add or invent anything):\n\n"
            + combined
        )
    elif has_images:
        prompt_parts.append(
            "Analyze the uploaded image(s) and extract key information to populate the one-pager. Use ONLY what you see in the images."
        )

    prompt_parts.append("Generate the complete, beautiful, print-ready one-pager HTML document now.")
    prompt = "\n\n".join(prompt_parts)

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
        custom_behaviour=TEMPLATE_BEHAVIOURS.get(template_style, TEMPLATE_BEHAVIOURS["executive_summary"]),
    )

    if response.get("error"):
        return response

    raw = response.get("result", "")
    html = _extract_html_response(raw)

    if not html or "<html" not in html.lower():
        return {
            "error": True,
            "message": "Could not generate HTML",
            "detail": "The AI did not return a valid HTML document. Please try again.",
        }

    return {
        "html": html,
        "chatHistoryId": response.get("chatHistoryId", chat_history_id),
    }


async def refine_one_pager_content(
    chat_history_id: str,
    message: str,
    current_html: str = "",
    template_style: str = "executive_summary",
) -> dict:
    """Continue the conversation to refine the one-pager HTML document."""
    brain_id = os.getenv("BPMN_CHECKER_BRAIN_ID") or os.getenv("SIGNAVIO_BRAIN_ID")
    if not brain_id:
        return {"error": True, "message": "API Not Active", "detail": "BPMN_CHECKER_BRAIN_ID is not configured."}

    if current_html:
        prompt = (
            f"Current template style: {template_style}\n\n"
            f"Current one-pager HTML:\n\n{current_html}\n\n"
            f"User request: {message}\n\n"
            "Apply the changes and return the complete updated HTML document."
        )
    else:
        prompt = message

    response = await call_brain_pure_llm_chat(
        brain_id,
        prompt,
        chat_history_id=chat_history_id,
        custom_behaviour=REFINE_BEHAVIOUR,
    )

    if response.get("error"):
        return response

    raw = response.get("result", "")
    html = _extract_html_response(raw)

    if not html or "<html" not in html.lower():
        return {
            "error": True,
            "message": "Refinement failed",
            "detail": "The AI did not return valid HTML. Please try rephrasing your request.",
        }

    return {
        "html": html,
        "chatHistoryId": response.get("chatHistoryId", chat_history_id),
    }

