"""
One Pager Creator Service.
AI generates a complete, self-contained HTML/CSS document for a single-page
one-pager. The HTML is previewed in an iframe and exported client-side as PNG.
"""
import os
import re

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

def _get_print_rules(orientation: str = "portrait") -> str:
    page_w = "1123px" if orientation == "landscape" else "794px"
    page_h = "794px" if orientation == "landscape" else "1123px"
    page_w_px = 1123 if orientation == "landscape" else 794
    page_h_px = 794 if orientation == "landscape" else 1123
    return f"""
Return ONLY raw HTML starting with <!DOCTYPE html> and ending with </html>. No markdown, no explanation.
All CSS in a single <style> tag inside <head>.

PAGE LAYOUT RULES:
- Each printed page is {page_w_px}px wide by {page_h_px}px tall.
- Wrap each page in <div class="page"> with: width:{page_w}; min-height:{page_h}; box-sizing:border-box;
- Do NOT set overflow:hidden on .page, html, or body — let content flow naturally.
- If all the content fits in one page, use a single <div class="page">. If there is too much content for one page, add a second <div class="page"> that is also fully designed — never leave a page half-empty.
- Use break-after:page on each .page div EXCEPT the last one. Never use break-before on .page — it creates blank first pages.
- Do NOT squash text tiny to force everything onto one page. Let content breathe with proper spacing.
- Set break-inside:avoid on cards and sections so they are not split at print boundaries.
- On html and body: width:{page_w}; margin:0; padding:0; box-sizing:border-box; overflow-x:hidden;

CSS RULES:
- Premium modern design using CSS Grid, Flexbox, gradients, shadows, CSS variables, pseudo-elements.
- STATIC only: no hover, focus, active, transition, animation, cursor, or keyframes.
- No external JavaScript. Pure HTML and CSS only.
- You may use icon fonts (FontAwesome via cdnjs) or inline SVGs.
- Generous padding (28px-36px) on all sides. Consistent inner padding (16px-20px) in cards. Clear gutters between columns. Body text 11px-13px, headings 14px-16px.

COLOR RULES:
- LIGHT MODE ONLY: white or very light background with dark readable text.
- Visually stunning: gradient text, subtle patterns, premium card layouts, ample white space.
- Clear visual hierarchy and intentional spacing.

IMAGE RULES:
- Use CSS gradients, border radii, and color blocks for decoration.
- If user provided images, reference them as <img src="user-image-1" alt="...">.

CONTENT RULES:
- Use ONLY information from the provided source material.
- Never invent company names, people, statistics, KPIs, or dates."""


_TEMPLATE_STYLE_PROMPTS = {
    "cheatsheet": """Create a dense, scannable cheatsheet one-pager. Multi-column layout, compact text, grouped sections with clear headers. Content-first — minimal decoration. Never cut off content.""",

    "flyer": """You are a creative print designer. Create a stunning PROMOTIONAL FLYER one-pager.

Vibe: bold and premium, like a real campaign flyer prepared by a design agency.
Layout: strong hero band at top, one focal message, supporting proof points, and a clear CTA zone at bottom. Use modern browser layout tools for punchy composition.
Style: expressive headline typography, controlled accent usage, large readable sections, and visual momentum from top to bottom.
Quality bar: avoid generic gradients and random blobs; every visual block should support the message.
Content behavior: concise persuasive copy with concrete benefits and outcomes.
Hero area: use a CSS gradient or solid color block for the hero background — NEVER an external image URL.
Background: use a light base (white or very light tint) for the overall page; reserve bold color only for hero bands or accent strips.""",

    "executive_summary": """You are a creative business document designer. Create a polished EXECUTIVE SUMMARY one-pager.

Vibe: board-ready, data-led, and high trust.
Layout: branded header, KPI strip, two-column narrative, and a crisp conclusion zone with strong alignment and spacing.
Style: restrained but premium, clear typographic hierarchy, strong alignment, and subtle but intentional accents.
Quality bar: this should look like a consultant-grade brief, not a generic AI report.
Content behavior: concise claims backed by concrete numbers, milestones, risks, and next steps.""",

    "infographic": """You are a creative infographic designer. Create a visually striking INFOGRAPHIC one-pager.

Vibe: visual-first narrative with clarity and momentum.
Layout: obvious reading path, large data callouts, and numbered blocks that guide the eye. Use grid or flex for side-by-side sections when useful.
Style: bold numeric hierarchy, strong contrast between data and explanation, and controlled accent colors.
Quality bar: avoid clipart-like styling and novelty effects; prioritize clarity and credibility.
Content behavior: every visual block should communicate one clear fact or step.""",
}


def _get_template_behaviour(template_style: str, orientation: str) -> str:
    style_prompt = _TEMPLATE_STYLE_PROMPTS.get(template_style, _TEMPLATE_STYLE_PROMPTS["executive_summary"])
    return style_prompt + "\n\n" + _get_print_rules(orientation)


def _get_refine_behaviour(orientation: str) -> str:
    page_w = "1123px" if orientation == "landscape" else "794px"
    page_h = "794px" if orientation == "landscape" else "1123px"
    return f"""You are an expert document designer. Modify the provided one-pager HTML document according to the user's request.

RULES:
- Return ONLY the complete updated HTML - start with <!DOCTYPE html>, end with </html>
- No markdown fences, no explanation - raw HTML only
- Preserve the template layout, visual design quality, and print readiness of the original
- Apply the user's changes precisely: content edits, color changes, section additions/removals, tone adjustments
- Keep output in light mode unless the user explicitly asks for dark mode
- Improve weak/generic sections when refining; do not return flat boilerplate design
- Use modern gradients, shadows, and top-tier layout patterns.

PAGE LAYOUT RULES:
- Each printed page is {page_w} by {page_h}. Content is wrapped in <div class="page"> blocks.
- Do NOT set overflow:hidden on .page, html, or body.
- If after refinement the content needs more than one page, add a second <div class="page"> fully designed with the remaining content. Never leave a page half-empty.
- Use break-inside:avoid on cards and sections so they are never split at print boundaries.

CSS CONSTRAINTS:
- Modern browser CSS allowed: flex, grid, CSS variables, gradients, pseudo-elements, shadows.
- STATIC only: no hover, focus, active, transition, animation, cursor, or keyframes.
- html/body: width:{page_w}; margin:0; padding:0; overflow-x:hidden; box-sizing:border-box;
- Generous spacing and readable fonts. Never squash content into tiny text."""


def _strip_external_images(html: str) -> str:
    """Remove any <img> tags whose src points to an external URL."""
    return re.sub(
        r'<img\b[^>]*\bsrc=["\'][^"\'>]*(?:http|//)[^"\'>]*["\'][^>]*/?>', 
        '', 
        html, 
        flags=re.IGNORECASE
    )


def _strip_interactive_css(html: str) -> str:
    """Remove interactive CSS properties so the exported one-pager stays static."""
    html = re.sub(r'\s*transition[^:]*:[^;]+;', '', html, flags=re.IGNORECASE)
    html = re.sub(r'\s*animation[^:]*:[^;]+;', '', html, flags=re.IGNORECASE)
    html = re.sub(r'\s*cursor\s*:[^;]+;', '', html, flags=re.IGNORECASE)
    html = re.sub(r'@keyframes\s+[\w-]+\s*\{[^}]*(?:\{[^}]*\}[^}]*)*\}', '', html, flags=re.IGNORECASE)
    return html


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
    return _strip_interactive_css(text)


async def extract_one_pager_content(
    pdf_bytes_list: list[tuple[str, bytes]],
    topic: str = "",
    key_points: str = "",
    audience: str = "",
    purpose: str = "",
    template_style: str = "executive_summary",
    orientation: str = "portrait",
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

    # Images are sent to the AI via vision — let it analyse them directly
    # instead of rejecting the request up-front.

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
        f"PAGE ORIENTATION: {orientation}",
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
            "The user uploaded image(s) as the primary source material. "
            "Carefully analyze every detail visible in the images — text, charts, data, diagrams, logos, and visual elements. "
            "Extract all key information and use it to populate the one-pager. Use ONLY what you see in the images."
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
        custom_behaviour=_get_template_behaviour(template_style, orientation),
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
    orientation: str = "portrait",
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
        custom_behaviour=_get_refine_behaviour(orientation),
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

