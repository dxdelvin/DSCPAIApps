"""
PPT Creator Service.
Handles AI-powered PowerPoint creation from uploaded PDF documents.
Reads PDF content, sends to AI for structuring into slides,
then builds a .pptx using varied layouts from the BSH template
with SmartArt-like diagrams and placeholder images.
"""
import io
import json
import math
import os
import re
import zipfile
from typing import List, Optional, Tuple

from PIL import Image, ImageDraw, ImageFont
from pptx import Presentation
from pptx.util import Inches, Pt, Emu
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_SHAPE
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR

from app.services.common_service import (
    create_chat_history,
    call_brain_pure_llm_chat,
    upload_attachments,
)

TEMPLATE_PATH = os.path.join(
    os.path.dirname(__file__), "..", "static", "docs", "pptTemplate.potx"
)

# ── Brand colours ──────────────────────────────────────────
BSH_ORANGE = RGBColor(0xFF, 0x5F, 0x00)
BSH_NAVY   = RGBColor(0x0F, 0x17, 0x2A)
BSH_WHITE  = RGBColor(0xFF, 0xFF, 0xFF)
BSH_GREY   = RGBColor(0x64, 0x74, 0x8B)

# ── Layout name → index mapping (from the .potx template) ──
LAYOUT_MAP = {
    "title_slide":          0,
    "title_slide_with_image": 2,
    "chapter":              3,
    "content":              6,
    "smart_art":            13,
    "content_with_image":   11,
    "image_with_content":   12,
    "two_columns":          8,
    "three_columns":        9,
    "four_quadrants":       10,
    "full_image":           7,
    "title_only":           13,
    "end_slide":            15,
}

# ── SmartArt colour palette ───────────────────────────────
SMART_ART_COLORS = [
    RGBColor(0xFF, 0x5F, 0x00),  # BSH Orange
    RGBColor(0x22, 0x8B, 0xE6),  # Blue
    RGBColor(0x10, 0xB9, 0x81),  # Green
    RGBColor(0x8B, 0x5C, 0xF6),  # Purple
    RGBColor(0xF5, 0x9E, 0x0B),  # Amber
    RGBColor(0xEF, 0x44, 0x44),  # Red
    RGBColor(0x06, 0xB6, 0xD4),  # Cyan
    RGBColor(0x0F, 0x17, 0x2A),  # BSH Navy
]

# ── AI behaviour prompts ──────────────────────────────────

EXTRACT_BEHAVIOUR = (
    "You are a professional presentation designer. "
    "You receive text extracted from PDF documents and must structure it into "
    "a compelling PowerPoint presentation.\n\n"
    "AVAILABLE SLIDE LAYOUTS (use the exact layout name):\n"
    '- "title_slide": Opening slide with title & subtitle\n'
    '- "title_slide_with_image": Title slide with image placeholder (RARELY use - only when opening slide strongly benefits from a visual)\n'
    '- "chapter": Section divider / new chapter heading\n'
    '- "content": Standard slide with title and bullet points\n'
    '- "smart_art": Visual diagram instead of plain bullets (see SMART ART TYPES)\n'
    '- "content_with_image": Text on left + image placeholder on right\n'
    '- "image_with_content": Image placeholder on left + text on right\n'
    '- "two_columns": Two side-by-side content areas\n'
    '- "three_columns": Three side-by-side content areas\n'
    '- "four_quadrants": Four content areas in a 2x2 grid\n'
    '- "full_image": Title + full-width image placeholder\n'
    '- "title_only": Slide with only a large title\n'
    '- "end_slide": Closing / thank-you slide\n\n'
    "SMART ART TYPES (use with layout \"smart_art\"):\n"
    '- "process": Horizontal flow showing sequential steps (3-6 items)\n'
    '- "list_blocks": Vertical accent blocks for features/categories (3-6 items)\n'
    '- "pyramid": Layered pyramid for hierarchy/priority (3-5 items, top=highest)\n'
    '- "matrix": 2x2 grid for comparisons/categories (exactly 4 items)\n'
    '- "cycle": Circular arrangement for recurring processes (3-6 items)\n'
    '- "timeline": Horizontal timeline with events/milestones (3-6 items)\n'
    '- "venn": Overlapping circles showing relationships (2-3 items)\n'
    '- "funnel": Conversion funnel - wide at top, narrow at bottom (3-5 items)\n\n'
    "RULES:\n"
    "1. Start with a title_slide and end with an end_slide.\n"
    "2. Use chapter slides to separate major sections.\n (Optional)"
    "3. Use VARIED layouts — do NOT use the same layout for every slide. (Use what feels natural for the content)\n"
    "4. Use \"smart_art\" layout for AT LEAST 25-30% of content slides. (Make sure it fits the content, see types below)\n"
    "Choose the type that best fits:\n"
    "   - Sequential steps/workflows -> process\n"
    "   - Features/specs/categories -> list_blocks\n"
    "   - Priority/hierarchy/levels -> pyramid\n"
    "   - 2x2 comparisons -> matrix\n"
    "   - Recurring/cyclical processes -> cycle\n"
    "5. Use image placeholder slides (content_with_image, image_with_content, "
    "full_image) where a visual would enhance the message.\n"
    "6. Keep bullet points concise (max 6 per slide, max 15 words each).\n"
    "7. Smart art items should be short labels (2-5 words each).\n"
    "8. For two_columns / three_columns / four_quadrants, provide content "
    "in the 'columns' array.\n"
    "9. For smart_art, you can optionally specify custom 'colors' array with hex values "
    "(e.g., ['#FF5F00', '#228BE6']). If not specified, default palette is used.\n\n"
    "Return your response as a valid JSON object with this EXACT structure:\n"
    "{\n"
    '  "title": "Presentation Title",\n'
    '  "subtitle": "Short subtitle",\n'
    '  "slides": [\n'
    "    {\n"
    '      "layout": "content",\n'
    '      "title": "Slide Title",\n'
    '      "subtitle": "Optional subtitle (title/chapter/end slides only)",\n'
    '      "bullets": ["Point 1", "Point 2"],\n'
    '      "smart_art": {"type": "process", "items": ["Step 1", "Step 2", "Step 3"], "colors": ["#FF5F00", "#228BE6"]},\n'
    '      "columns": [\n'
    '        {"heading": "Col 1", "bullets": ["item"]},\n'
    '        {"heading": "Col 2", "bullets": ["item"]}\n'
    "      ],\n"
    '      "image_description": "Brief description of what image should show",\n'
    '      "notes": "Speaker notes"\n'
    "    }\n"
    "  ]\n"
    "}\n\n"
    "FIELD USAGE BY LAYOUT:\n"
    "- title_slide / chapter / end_slide: title + subtitle\n"
    "- title_slide_with_image: title + subtitle + image_description\n"
    "- content: title + bullets\n"
    "- smart_art: title + smart_art object (type + items + optional colors)\n"
    "- content_with_image / image_with_content: title + bullets + image_description\n"
    "- two_columns / three_columns / four_quadrants: title + columns\n"
    "- full_image: title + image_description\n\n"
    "CRITICAL — USER INSTRUCTIONS OVERRIDE:\n"
    "If the user provides additional instructions (e.g., color preferences, slide count like 'one pager', "
    "specific themes, layout preferences, or any other customisation), you MUST follow them and they take "
    "HIGHEST PRIORITY over all other rules above. For example:\n"
    "- 'one pager' or 'single slide' = produce only 1-2 slides max with all key content condensed.\n"
    "- Color requests = apply the requested colors via smart_art.colors arrays and adjust content tone.\n"
    "- Slide count requests = strictly respect the requested number of slides.\n"
    "- Style/tone requests = adapt language, bullet length, and layout choices accordingly.\n\n"
    "Return ONLY the JSON, no markdown fences, no explanation."
)

REFINE_BEHAVIOUR = (
    "You are a PowerPoint content editor. "
    "The user wants changes to the presentation content. "
    "Apply the requested changes and return the FULL updated JSON "
    "with the same structure (title, subtitle, slides array with layout field). "
    "Keep using varied layouts including smart_art where appropriate. "
    "Available smart_art types: process, list_blocks, pyramid, matrix, cycle, timeline, venn, funnel. "
    "For color changes, specify hex color codes in the smart_art.colors array. "
    "Return ONLY the JSON, no markdown fences, no explanation."
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
        # Limit to first 95K characters
        if len(full_text) > 90000:
            full_text = full_text[:90000] + "\n\n[Content truncated at 90K characters. Only first portion processed.]"
        # Check if meaningful content was extracted (not just headers/footers)
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


# ─── Placeholder image generation ────────────────────────

def _create_placeholder_image(
    description: str = "Image Placeholder",
    width_px: int = 800,
    height_px: int = 600,
) -> io.BytesIO:
    """Create a simple grey placeholder image with BSH branding."""
    img = Image.new("RGB", (width_px, height_px), (200, 200, 200))
    draw = ImageDraw.Draw(img)

    # Simple grey box
    draw.rectangle([0, 0, width_px, height_px], fill=(220, 220, 220), outline=(180, 180, 180), width=2)

    # BSH text
    try:
        bsh_font = ImageFont.truetype("arial.ttf", max(36, min(width_px, height_px) // 15))
    except (OSError, IOError):
        bsh_font = ImageFont.load_default()

    bsh_text = "BSH"
    bsh_bbox = draw.textbbox((0, 0), bsh_text, font=bsh_font)
    bsh_w = bsh_bbox[2] - bsh_bbox[0]
    bsh_h = bsh_bbox[3] - bsh_bbox[1]
    draw.text(((width_px - bsh_w) // 2, height_px // 2 - bsh_h - 10), bsh_text, fill=(100, 100, 100), font=bsh_font)

    # Placeholder Image text
    try:
        label_font = ImageFont.truetype("arial.ttf", max(14, min(width_px, height_px) // 30))
    except (OSError, IOError):
        label_font = ImageFont.load_default()

    label = "Placeholder Image"
    label_bbox = draw.textbbox((0, 0), label, font=label_font)
    label_w = label_bbox[2] - label_bbox[0]
    draw.text(((width_px - label_w) // 2, height_px // 2 + 20), label, fill=(120, 120, 120), font=label_font)

    buf = io.BytesIO()
    img.save(buf, format="PNG")
    buf.seek(0)
    return buf


# ─── SmartArt-like shape builders ────────────────────────

def _get_sa_color(idx: int, custom_colors: list = None) -> RGBColor:
    """Get a colour from custom list or default SmartArt palette."""
    if custom_colors and idx < len(custom_colors):
        hex_color = custom_colors[idx].lstrip('#')
        try:
            return RGBColor(int(hex_color[0:2], 16), int(hex_color[2:4], 16), int(hex_color[4:6], 16))
        except (ValueError, IndexError):
            pass
    return SMART_ART_COLORS[idx % len(SMART_ART_COLORS)]


def _add_shape_with_text(
    slide, shape_type, left, top, width, height,
    text, fill_color, text_color=None, font_size=Pt(12), bold=True,
):
    """Add a shape with centred text."""
    shape = slide.shapes.add_shape(shape_type, left, top, width, height)
    shape.fill.solid()
    shape.fill.fore_color.rgb = fill_color
    shape.line.fill.background()

    tf = shape.text_frame
    tf.word_wrap = True
    tf.margin_top = Inches(0.05)
    tf.margin_bottom = Inches(0.05)
    p = tf.paragraphs[0]
    p.alignment = PP_ALIGN.CENTER
    p.text = text
    run = p.runs[0]
    run.font.size = font_size
    run.font.color.rgb = text_color or BSH_WHITE
    run.font.bold = bold
    return shape


def _draw_process_smart_art(slide, items, custom_colors=None):
    """Horizontal process flow — rounded boxes with arrows between them."""
    n = len(items)
    if n == 0:
        return

    area_left = Inches(0.6)
    area_top = Inches(1.8)
    area_w = Inches(10.8)
    area_h = Inches(4.0)

    arrow_w = Inches(0.25)
    gap = Inches(0.1)

    total_arrow_space = max(0, n - 1) * (arrow_w + gap * 2)
    box_w = min(int((area_w - total_arrow_space) / n), Inches(2.5))
    box_h = Inches(1.2)
    fs = Pt(12) if box_w > Inches(1.8) else Pt(10) if box_w > Inches(1.2) else Pt(9)

    total_w = n * box_w + max(0, n - 1) * (arrow_w + gap * 2)
    start_x = area_left + (area_w - total_w) // 2
    y = area_top + (area_h - box_h) // 2

    x = start_x
    for i, item in enumerate(items):
        _add_shape_with_text(
            slide, MSO_SHAPE.ROUNDED_RECTANGLE,
            int(x), int(y), int(box_w), int(box_h),
            item, _get_sa_color(i, custom_colors), BSH_WHITE, fs, True,
        )
        x += box_w
        if i < n - 1:
            x += gap
            arrow = slide.shapes.add_shape(
                MSO_SHAPE.RIGHT_ARROW,
                int(x), int(y + box_h // 2 - Inches(0.15)),
                int(arrow_w), int(Inches(0.3)),
            )
            arrow.fill.solid()
            arrow.fill.fore_color.rgb = BSH_GREY
            arrow.line.fill.background()
            x += arrow_w + gap


def _draw_list_blocks_smart_art(slide, items, custom_colors=None):
    """Vertical accent blocks with coloured left bar."""
    n = len(items)
    if n == 0:
        return

    area_left = Inches(1.5)
    area_top = Inches(1.8)
    area_w = Inches(9)
    area_h = Inches(4.5)

    gap = Inches(0.15)
    block_h = min(int((area_h - (n - 1) * gap) / n), Inches(0.9))
    accent_w = Inches(0.12)
    total_h = n * block_h + (n - 1) * gap
    y = area_top + (area_h - total_h) // 2

    for i, item in enumerate(items):
        color = _get_sa_color(i, custom_colors)

        # Accent bar
        accent = slide.shapes.add_shape(
            MSO_SHAPE.RECTANGLE,
            int(area_left), int(y), int(accent_w), int(block_h),
        )
        accent.fill.solid()
        accent.fill.fore_color.rgb = color
        accent.line.fill.background()

        # Content block
        blk = slide.shapes.add_shape(
            MSO_SHAPE.ROUNDED_RECTANGLE,
            int(area_left + accent_w + Inches(0.08)), int(y),
            int(area_w - accent_w - Inches(0.08)), int(block_h),
        )
        blk.fill.solid()
        blk.fill.fore_color.rgb = RGBColor(0xF8, 0xFA, 0xFC)
        blk.line.color.rgb = RGBColor(0xE2, 0xE8, 0xF0)
        blk.line.width = Pt(1)

        tf = blk.text_frame
        tf.word_wrap = True
        tf.margin_left = Inches(0.3)
        tf.margin_top = Inches(0.1)
        p = tf.paragraphs[0]
        p.text = item
        p.alignment = PP_ALIGN.LEFT
        run = p.runs[0]
        run.font.size = Pt(13)
        run.font.color.rgb = BSH_NAVY
        run.font.bold = True

        y += block_h + gap


def _draw_pyramid_smart_art(slide, items, custom_colors=None):
    """Pyramid — widest at bottom, narrowest at top."""
    n = len(items)
    if n == 0:
        return

    area_left = Inches(1)
    area_top = Inches(1.8)
    area_w = Inches(10)
    area_h = Inches(4.5)

    gap = Inches(0.1)
    layer_h = min(int((area_h - (n - 1) * gap) / n), Inches(1))
    total_h = n * layer_h + (n - 1) * gap
    y = area_top + (area_h - total_h) // 2

    center_x = area_left + area_w // 2
    min_w = Inches(3)
    max_w = area_w

    for i, item in enumerate(items):
        frac = (n - 1 - i) / max(n - 1, 1)
        w = int(min_w + frac * (max_w - min_w))
        left = int(center_x - w // 2)
        _add_shape_with_text(
            slide, MSO_SHAPE.ROUNDED_RECTANGLE,
            left, int(y), w, int(layer_h),
            item, _get_sa_color(i, custom_colors), BSH_WHITE, Pt(12), True,
        )
        y += layer_h + gap


def _draw_matrix_smart_art(slide, items, custom_colors=None):
    """2x2 matrix grid."""
    padded = (items + ["", "", "", ""])[:4]

    area_left = Inches(1.5)
    area_top = Inches(1.8)
    area_w = Inches(9)
    area_h = Inches(4.2)

    gap = Inches(0.25)
    cell_w = int((area_w - gap) / 2)
    cell_h = int((area_h - gap) / 2)

    positions = [
        (area_left, area_top),
        (area_left + cell_w + gap, area_top),
        (area_left, area_top + cell_h + gap),
        (area_left + cell_w + gap, area_top + cell_h + gap),
    ]

    for i, (item, (x, y)) in enumerate(zip(padded, positions)):
        if not item:
            continue
        _add_shape_with_text(
            slide, MSO_SHAPE.ROUNDED_RECTANGLE,
            int(x), int(y), cell_w, cell_h,
            item, _get_sa_color(i, custom_colors), BSH_WHITE, Pt(14), True,
        )


def _draw_cycle_smart_art(slide, items, custom_colors=None):
    """Items in a circular arrangement representing a cycle."""
    n = len(items)
    if n == 0:
        return

    area_left = Inches(0.8)
    area_top = Inches(1.5)
    area_w = Inches(10.4)
    area_h = Inches(5)

    cx = area_left + area_w // 2
    cy = area_top + area_h // 2

    node_w = Inches(2)
    node_h = Inches(0.85)
    radius_x = (area_w - node_w) // 2 - Inches(0.3)
    radius_y = (area_h - node_h) // 2 - Inches(0.2)

    # Background circle outline
    cr = min(radius_x, radius_y) + Inches(0.15)
    circle = slide.shapes.add_shape(
        MSO_SHAPE.OVAL,
        int(cx - cr), int(cy - cr), int(cr * 2), int(cr * 2),
    )
    circle.fill.background()
    circle.line.color.rgb = RGBColor(0xCB, 0xD5, 0xE1)
    circle.line.width = Pt(1.5)

    for i, item in enumerate(items):
        angle = 2 * math.pi * i / n - math.pi / 2
        x = cx + radius_x * math.cos(angle) - node_w // 2
        y = cy + radius_y * math.sin(angle) - node_h // 2

        _add_shape_with_text(
            slide, MSO_SHAPE.ROUNDED_RECTANGLE,
            int(x), int(y), int(node_w), int(node_h),
            item, _get_sa_color(i, custom_colors), BSH_WHITE, Pt(11), True,
        )


def _draw_timeline_smart_art(slide, items, custom_colors=None):
    """Horizontal timeline with milestone markers."""
    n = len(items)
    if n == 0:
        return

    area_left = Inches(1)
    area_top = Inches(2.5)
    area_w = Inches(10)
    line_y = area_top + Inches(1)

    # Timeline line
    line = slide.shapes.add_shape(
        MSO_SHAPE.RECTANGLE,
        int(area_left), int(line_y - Inches(0.02)),
        int(area_w), int(Inches(0.04)),
    )
    line.fill.solid()
    line.fill.fore_color.rgb = BSH_GREY
    line.line.fill.background()

    gap = area_w / max(n - 1, 1) if n > 1 else 0
    marker_r = Inches(0.15)

    for i, item in enumerate(items):
        x = area_left + (gap * i if n > 1 else area_w // 2)
        
        # Marker circle
        marker = slide.shapes.add_shape(
            MSO_SHAPE.OVAL,
            int(x - marker_r), int(line_y - marker_r),
            int(marker_r * 2), int(marker_r * 2),
        )
        marker.fill.solid()
        marker.fill.fore_color.rgb = _get_sa_color(i, custom_colors)
        marker.line.fill.background()

        # Label (alternating above/below)
        label_y = line_y - Inches(0.8) if i % 2 == 0 else line_y + Inches(0.4)
        _add_textbox(slide, item, int(x - Inches(0.8)), int(label_y), int(Inches(1.6)), int(Inches(0.4)), Pt(11), True, BSH_NAVY)


def _draw_venn_smart_art(slide, items, custom_colors=None):
    """Overlapping circles (2-3 circles) showing relationships."""
    n = min(len(items), 3)
    if n == 0:
        return

    area_left = Inches(2)
    area_top = Inches(2)
    circle_d = Inches(3)

    if n == 2:
        positions = [
            (area_left + Inches(1.5), area_top + Inches(1)),
            (area_left + Inches(3.5), area_top + Inches(1)),
        ]
    else:  # n == 3
        positions = [
            (area_left + Inches(2.5), area_top + Inches(0.5)),
            (area_left + Inches(1.5), area_top + Inches(2)),
            (area_left + Inches(3.5), area_top + Inches(2)),
        ]

    for i in range(n):
        x, y = positions[i]
        circle = slide.shapes.add_shape(
            MSO_SHAPE.OVAL,
            int(x), int(y), int(circle_d), int(circle_d),
        )
        circle.fill.solid()
        color = _get_sa_color(i, custom_colors)
        circle.fill.fore_color.rgb = color
        circle.fill.transparency = 0.5
        circle.line.color.rgb = color
        circle.line.width = Pt(2)

        # Label
        tf = circle.text_frame
        tf.word_wrap = True
        p = tf.paragraphs[0]
        p.text = items[i]
        p.alignment = PP_ALIGN.CENTER
        p.runs[0].font.size = Pt(12)
        p.runs[0].font.color.rgb = BSH_NAVY
        p.runs[0].font.bold = True


def _draw_funnel_smart_art(slide, items, custom_colors=None):
    """Conversion funnel - wide at top, narrow at bottom."""
    n = len(items)
    if n == 0:
        return

    area_left = Inches(2)
    area_top = Inches(1.8)
    area_w = Inches(8)
    area_h = Inches(4.5)

    gap = Inches(0.1)
    stage_h = (area_h - (n - 1) * gap) / n

    y = area_top
    for i, item in enumerate(items):
        # Calculate width - narrow from top to bottom
        frac = 1 - (i / max(n, 1)) * 0.6  # 100% to 40% width
        w = int(area_w * frac)
        x = int(area_left + (area_w - w) // 2)

        shape = slide.shapes.add_shape(
            MSO_SHAPE.ROUNDED_RECTANGLE,
            x, int(y), w, int(stage_h),
        )
        shape.fill.solid()
        shape.fill.fore_color.rgb = _get_sa_color(i, custom_colors)
        shape.line.fill.background()

        tf = shape.text_frame
        tf.word_wrap = True
        p = tf.paragraphs[0]
        p.alignment = PP_ALIGN.CENTER
        p.text = item
        run = p.runs[0]
        run.font.size = Pt(13)
        run.font.color.rgb = BSH_WHITE
        run.font.bold = True

        y += stage_h + gap


SMART_ART_DRAWERS = {
    "process": _draw_process_smart_art,
    "list_blocks": _draw_list_blocks_smart_art,
    "pyramid": _draw_pyramid_smart_art,
    "matrix": _draw_matrix_smart_art,
    "cycle": _draw_cycle_smart_art,
    "timeline": _draw_timeline_smart_art,
    "venn": _draw_venn_smart_art,
    "funnel": _draw_funnel_smart_art,
}


# ─── Template loader ─────────────────────────────────────

def _load_template() -> Presentation:
    """Load the .potx template, patching Content_Types for python-pptx compatibility."""
    if os.path.exists(TEMPLATE_PATH):
        raw = io.BytesIO()
        with zipfile.ZipFile(TEMPLATE_PATH, "r") as zin, zipfile.ZipFile(raw, "w") as zout:
            for item in zin.infolist():
                data = zin.read(item.filename)
                if item.filename == "[Content_Types].xml":
                    data = data.replace(
                        b"application/vnd.openxmlformats-officedocument.presentationml.template.main+xml",
                        b"application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml",
                    )
                zout.writestr(item, data)
        raw.seek(0)
        return Presentation(raw)
    else:
        prs = Presentation()
        prs.slide_width = Inches(13.333)
        prs.slide_height = Inches(7.5)
        return prs


# ─── Slide builders ──────────────────────────────────────

def _set_placeholder_text(slide, ph_idx: int, text: str):
    """Safely set text on a placeholder by index."""
    try:
        slide.placeholders[ph_idx].text = text
    except (KeyError, IndexError):
        pass


def _fill_bullets(placeholder, bullets: list[str]):
    """Fill a content placeholder with bullet points."""
    try:
        tf = placeholder.text_frame
        tf.clear()
        for j, bullet in enumerate(bullets):
            if j == 0:
                tf.paragraphs[0].text = bullet
                _style_para(tf.paragraphs[0], Pt(16), BSH_NAVY)
            else:
                p = tf.add_paragraph()
                p.text = bullet
                _style_para(p, Pt(16), BSH_NAVY)
    except Exception:
        pass


def _insert_placeholder_image(slide, ph_idx: int, description: str):
    """Insert a placeholder image into a picture placeholder."""
    try:
        pic_ph = slide.placeholders[ph_idx]
        img_buf = _create_placeholder_image(description)
        pic_ph.insert_picture(img_buf)
    except (KeyError, IndexError, Exception):
        pass


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


def _build_title_slide(prs, slide_data, layout):
    """Build a title / chapter / end slide."""
    slide = prs.slides.add_slide(layout)
    _set_placeholder_text(slide, 0, slide_data.get("title", ""))
    subtitle = slide_data.get("subtitle", "")
    if subtitle:
        _set_placeholder_text(slide, 1, subtitle)
    return slide


def _build_content_slide(prs, slide_data, layout):
    """Build a standard content slide with title + bullets."""
    slide = prs.slides.add_slide(layout)
    _set_placeholder_text(slide, 0, slide_data.get("title", ""))
    bullets = slide_data.get("bullets", [])
    if bullets:
        try:
            _fill_bullets(slide.placeholders[1], bullets)
        except (KeyError, IndexError):
            y = Inches(1.6)
            for b in bullets:
                _add_textbox(slide, f"• {b}", Inches(1), y, Inches(11), Inches(0.5), Pt(16), False, BSH_NAVY)
                y += Inches(0.55)
    return slide


def _build_content_with_image_slide(prs, slide_data, layout):
    """Build text+image slide (layout 11: text left, picture right)."""
    slide = prs.slides.add_slide(layout)
    _set_placeholder_text(slide, 0, slide_data.get("title", ""))
    bullets = slide_data.get("bullets", [])
    if bullets:
        try:
            _fill_bullets(slide.placeholders[1], bullets)
        except (KeyError, IndexError):
            pass
    desc = slide_data.get("image_description", "Relevant visual")
    _insert_placeholder_image(slide, 2, desc)
    return slide


def _build_image_with_content_slide(prs, slide_data, layout):
    """Build image+text slide (layout 12: picture left, text right)."""
    slide = prs.slides.add_slide(layout)
    _set_placeholder_text(slide, 0, slide_data.get("title", ""))
    bullets = slide_data.get("bullets", [])
    if bullets:
        try:
            _fill_bullets(slide.placeholders[2], bullets)
        except (KeyError, IndexError):
            pass
    desc = slide_data.get("image_description", "Relevant visual")
    _insert_placeholder_image(slide, 1, desc)
    return slide


def _build_full_image_slide(prs, slide_data, layout):
    """Build title + full image slide (layout 7)."""
    slide = prs.slides.add_slide(layout)
    _set_placeholder_text(slide, 0, slide_data.get("title", ""))
    desc = slide_data.get("image_description", "Full-width visual")
    _insert_placeholder_image(slide, 1, desc)
    return slide


def _build_multi_column_slide(prs, slide_data, layout, num_cols: int):
    """Build a multi-column slide (2, 3, or 4 columns)."""
    slide = prs.slides.add_slide(layout)
    _set_placeholder_text(slide, 0, slide_data.get("title", ""))

    columns = slide_data.get("columns", [])

    for col_idx in range(num_cols):
        ph_idx = col_idx + 1
        if col_idx < len(columns):
            col_data = columns[col_idx]
            heading = col_data.get("heading", "")
            col_bullets = col_data.get("bullets", [])
            all_text = []
            if heading:
                all_text.append(heading)
            all_text.extend(col_bullets)
            if all_text:
                try:
                    tf = slide.placeholders[ph_idx].text_frame
                    tf.clear()
                    for j, txt in enumerate(all_text):
                        if j == 0:
                            tf.paragraphs[0].text = txt
                            _style_para(
                                tf.paragraphs[0],
                                Pt(16) if j == 0 and heading else Pt(14),
                                BSH_NAVY,
                                j == 0 and bool(heading),
                            )
                        else:
                            p = tf.add_paragraph()
                            p.text = txt
                            _style_para(p, Pt(14), BSH_NAVY)
                except (KeyError, IndexError):
                    pass

    return slide


def _build_title_only_slide(prs, slide_data, layout):
    """Build a title-only slide (layout 13)."""
    slide = prs.slides.add_slide(layout)
    _set_placeholder_text(slide, 0, slide_data.get("title", ""))
    return slide


def _build_smart_art_slide(prs, slide_data, layout):
    """Build a slide with SmartArt-like diagram shapes."""
    slide = prs.slides.add_slide(layout)
    _set_placeholder_text(slide, 0, slide_data.get("title", ""))

    sa = slide_data.get("smart_art", {})
    sa_type = sa.get("type", "list_blocks")
    sa_items = sa.get("items", [])
    sa_colors = sa.get("colors", None)

    drawer = SMART_ART_DRAWERS.get(sa_type)
    if drawer and sa_items:
        drawer(slide, sa_items, sa_colors)

    return slide    


# ─── Main PPT builder ────────────────────────────────────

def generate_pptx_file(content: dict, username: str = "Unknown User") -> io.BytesIO:
    """
    Build a .pptx from structured AI content using varied template layouts.
    Inserts SmartArt diagrams and placeholder images where indicated.
    Adds footer with date and username to each slide.
    """
    from datetime import datetime
    
    prs = _load_template()
    
    # Remove any default slides that come with the template
    while len(prs.slides) > 0:
        rId = prs.slides._sldIdLst[0].rId
        prs.part.drop_rel(rId)
        del prs.slides._sldIdLst[0]
    
    slides_data = content.get("slides", [])
    current_date = datetime.now().strftime("%B %d, %Y")  # e.g., "March 01, 2026"

    for slide_data in slides_data:
        layout_name = slide_data.get("layout", "content")
        layout_idx = LAYOUT_MAP.get(layout_name, LAYOUT_MAP["content"])

        if layout_idx >= len(prs.slide_layouts):
            layout_idx = LAYOUT_MAP["content"]

        layout = prs.slide_layouts[layout_idx]

        if layout_name in ("title_slide", "chapter", "end_slide"):
            slide = _build_title_slide(prs, slide_data, layout)

        elif layout_name == "title_slide_with_image":
            slide = _build_title_slide(prs, slide_data, layout)
            # Add image placeholder if description provided
            desc = slide_data.get("image_description", "Opening visual")
            _insert_placeholder_image(slide, 2, desc)

        elif layout_name == "content":
            slide = _build_content_slide(prs, slide_data, layout)

        elif layout_name == "smart_art":
            slide = _build_smart_art_slide(prs, slide_data, layout)

        elif layout_name == "content_with_image":
            slide = _build_content_with_image_slide(prs, slide_data, layout)

        elif layout_name == "image_with_content":
            slide = _build_image_with_content_slide(prs, slide_data, layout)

        elif layout_name == "full_image":
            slide = _build_full_image_slide(prs, slide_data, layout)

        elif layout_name == "two_columns":
            slide = _build_multi_column_slide(prs, slide_data, layout, 2)

        elif layout_name == "three_columns":
            slide = _build_multi_column_slide(prs, slide_data, layout, 3)

        elif layout_name == "four_quadrants":
            slide = _build_multi_column_slide(prs, slide_data, layout, 4)

        elif layout_name == "title_only":
            slide = _build_title_only_slide(prs, slide_data, layout)

        else:
            slide = _build_content_slide(prs, slide_data, layout)

        notes = slide_data.get("notes", "")
        if notes:
            try:
                slide.notes_slide.notes_text_frame.text = notes
            except Exception:
                pass
        
        # Add footer with date and username (bottom-left) - only on title_slide and end_slide
        if layout_name in ("title_slide", "title_slide_with_image", "end_slide"):
            try:
                footer_text = f"{current_date}\n{username}"
                footer_box = slide.shapes.add_textbox(
                    Inches(0.3), 
                    prs.slide_height - Inches(0.6),
                    Inches(2.5), 
                    Inches(0.4)
                )
                tf = footer_box.text_frame
                tf.word_wrap = True
                p = tf.paragraphs[0]
                p.text = footer_text
                for run in p.runs:
                    run.font.size = Pt(8)
                    run.font.color.rgb = BSH_WHITE  # White color
            except Exception:
                pass  # Silently fail if footer can't be added

    buf = io.BytesIO()
    prs.save(buf)
    buf.seek(0)
    return buf


# ─── Public API ─────────────────────────────────────────────

async def extract_pdf_content(
    pdf_bytes_list: list[tuple[str, bytes]],
    user_instructions: str = "",
    username: str = "Unknown User",
    image_files: list = None,
) -> dict:
    """
    Extract text from uploaded PDFs and/or process uploaded images via AI vision,
    then structure content into presentation slides.
    Returns dict with 'content' (parsed JSON), 'chatHistoryId', or 'error'.
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

    base_task = (
        "Create a professional PowerPoint presentation from this content.\n"
        "Use varied slide layouts and SmartArt diagrams to make it visually engaging.\n"
        "Include image placeholder slides where visuals would enhance the message."
    )

    if has_text:
        body = f"Below is text content extracted from uploaded documents.\n{base_task}\n\n{combined_text}"
    else:
        body = f"Analyze the uploaded image(s) and {base_task}"

    if user_instructions:
        prompt = (
            f"\u26a0\ufe0f USER INSTRUCTIONS (HIGHEST PRIORITY \u2014 follow these strictly):\n{user_instructions}\n\n"
            f"---\n\n{body}"
        )
    else:
        prompt = body

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
        custom_behaviour=EXTRACT_BEHAVIOUR,
    )

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
        "username": username,
    }


async def refine_ppt_content(
    chat_history_id: str,
    message: str,
    current_content: dict = None,
) -> dict:
    """Continue the conversation to refine the presentation content."""
    brain_id = os.getenv("DSCP_BRAIN_ID")
    if not brain_id:
        return {"error": True, "message": "API Not Active", "detail": "DSCP_BRAIN_ID is not configured."}

    prompt = message
    if current_content:
        prompt = (
            f"Here is the current presentation JSON:\n{json.dumps(current_content, indent=2)}\n\n"
            f"User request: {message}\n\n"
            "Apply the changes and return the FULL updated JSON with the same structure "
            "(title, subtitle, slides array with layout field)."
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
    parsed = _parse_json_response(raw)

    if not parsed or "slides" not in parsed:
        return {
            "result": raw,
            "chatHistoryId": response.get("chatHistoryId", chat_history_id),
        }

    return {
        "content": parsed,
        "chatHistoryId": response.get("chatHistoryId", chat_history_id),
    }
