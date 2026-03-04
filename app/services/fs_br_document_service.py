
import io
import os
from typing import List, Optional

from docx import Document
from docx.shared import Inches, Pt, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml.ns import qn
from docx.oxml import OxmlElement


# ─── Paths & constants ────────────────────────────────────

TEMPLATE_PATH = os.path.join(
    os.path.dirname(__file__), "..", "static", "docs",
    "Functional_Specification_Template.docx",
)

BR_TEMPLATE_PATH = os.path.join(
    os.path.dirname(__file__), "..", "static", "docs",
    "Business_requirement_template.docx",
)

# XML namespace for Word 2010 checkbox SDT elements
W14_NS = "http://schemas.microsoft.com/office/word/2010/wordml"

BSH_GREY = RGBColor(0x64, 0x74, 0x8B)


# ─── Low-level helpers ────────────────────────────────────

def _get_cell_label(cell) -> str:
    """Extract label text from a checkbox table cell (strips checkbox char and whitespace)."""
    return cell.text.strip().lstrip("\u2610\u2612 ").strip()


def _check_cell_checkbox(cell):
    """Toggle a Word SDT checkbox inside a table cell to checked."""
    for sdt in cell._element.iter(qn("w:sdt")):
        # Set w14:checked val="1"
        for elem in sdt.iter():
            if elem.tag == f"{{{W14_NS}}}checked":
                elem.set(f"{{{W14_NS}}}val", "1")
        # Swap display glyph
        for t_elem in sdt.iter(qn("w:t")):
            if t_elem.text and "\u2610" in t_elem.text:
                t_elem.text = t_elem.text.replace("\u2610", "\u2612")


def _toggle_column_checkboxes(table, col_selections: dict, header_row: bool = True):
    """
    Check table cells per-column.
    col_selections: {col_index: [selected_items]}
    Handles 'Other' appearing in multiple columns without cross-contamination.
    """
    start_row = 1 if header_row else 0
    for col_idx, selected in col_selections.items():
        normalised = {s.strip().lower() for s in selected if s}
        if not normalised:
            continue
        for row in table.rows[start_row:]:
            if col_idx < len(row.cells):
                cell = row.cells[col_idx]
                label = _get_cell_label(cell)
                if label and label.lower() in normalised:
                    _check_cell_checkbox(cell)


def _toggle_table_checkboxes(table, selected_items: list, header_row: bool = False):
    """Check all cells whose label matches any item in selected_items (flat list)."""
    start_row = 1 if header_row else 0
    normalised = {s.strip().lower() for s in selected_items if s}
    if not normalised:
        return
    for row in table.rows[start_row:]:
        for cell in row.cells:
            label = _get_cell_label(cell)
            if label and label.lower() in normalised:
                _check_cell_checkbox(cell)


def _set_para_text(para, text: str):
    """Replace a paragraph's text, preserving the first run's formatting."""
    if para.runs:
        for run in para.runs[1:]:
            run.text = ""
        para.runs[0].text = text
    else:
        para.add_run(text)


def _remove_paragraph(para):
    """Remove a paragraph element from the document body."""
    p = para._element
    parent = p.getparent()
    if parent is not None:
        parent.remove(p)


def _insert_text_para_after(ref_element, text: str, bold=False, italic=False):
    """Insert a new w:p with text after ref_element. Returns the new w:p element."""
    new_p = OxmlElement("w:p")
    new_r = OxmlElement("w:r")

    rpr = OxmlElement("w:rPr")
    if bold:
        rpr.append(OxmlElement("w:b"))
    if italic:
        rpr.append(OxmlElement("w:i"))
    new_r.append(rpr)

    new_t = OxmlElement("w:t")
    new_t.set(qn("xml:space"), "preserve")
    new_t.text = text
    new_r.append(new_t)
    new_p.append(new_r)

    ref_element.addnext(new_p)
    return new_p


def _insert_images_after(doc, ref_element, images: list):
    """Insert images into the document body right after ref_element."""
    if not images:
        return ref_element

    body = doc.element.body
    current_ref = ref_element

    for img_info in images:
        img_stream = io.BytesIO(img_info["data"])
        try:
            # Add picture to end of document (creates relationship + element)
            doc.add_picture(img_stream, width=Inches(3.0))
            pic_para = doc.paragraphs[-1]
            pic_para.alignment = WD_ALIGN_PARAGRAPH.CENTER

            # Move the picture element to the correct position
            pic_elem = pic_para._element
            body.remove(pic_elem)
            current_ref.addnext(pic_elem)
            current_ref = pic_elem

            # Add a caption paragraph after the picture
            cap_p = OxmlElement("w:p")
            # Center alignment
            ppr = OxmlElement("w:pPr")
            jc = OxmlElement("w:jc")
            jc.set(qn("w:val"), "center")
            ppr.append(jc)
            cap_p.append(ppr)
            # Caption run (italic, 9pt, grey)
            cap_r = OxmlElement("w:r")
            rpr = OxmlElement("w:rPr")
            rpr.append(OxmlElement("w:i"))
            sz = OxmlElement("w:sz")
            sz.set(qn("w:val"), "18")  # 9pt in half-points
            rpr.append(sz)
            clr = OxmlElement("w:color")
            clr.set(qn("w:val"), "64748B")
            rpr.append(clr)
            cap_r.append(rpr)
            cap_t = OxmlElement("w:t")
            cap_t.text = img_info.get("name", "Screenshot")
            cap_r.append(cap_t)
            cap_p.append(cap_r)

            current_ref.addnext(cap_p)
            current_ref = cap_p

        except Exception:
            err_p = _insert_text_para_after(
                current_ref,
                f"[Image: {img_info.get('name', 'unknown')} — could not be embedded]",
                italic=True,
            )
            current_ref = err_p

    return current_ref


# ─── Main generator ───────────────────────────────────────

def generate_functional_spec_docx(
    data: dict,
    problem_images: List[dict] = None,
    solution_images: List[dict] = None,
) -> io.BytesIO:
    """
    Fill the BSH Functional Specification template with form data.
    Returns an in-memory BytesIO buffer ready for streaming.

    Template paragraph-index map (Functional_Specification_Template.docx):
      [ 0] Heading 1  "Functional Specification"
      [ 1] spacer
      [ 2] Heading 2  "User Story"
      [ 3] Normal     "I as a ..."
      [ 4] Normal     "want to ..."
      [ 5] Normal     "to be able to ..."
      [ 6] spacer
      [ 7] Heading 2  "Process"
      [ 8] spacer                       (before Table 0)
          TABLE 0 -- Process checkboxes  (10 rows x 3 cols)
      [ 9] spacer                       (after Table 0)
      [10] Normal     "If you did not find a suitable Function and Area ..."
      [11] spacer                       (describe-below placeholder)
      [12] Heading 2  "User"
      [13] spacer                       (before Table 1)
          TABLE 1 -- User checkboxes     (3 rows x 3 cols, no header row)
      [14] spacer                       (after Table 1)
      [15] Normal     "If you did not find a suitable User-Group ..."
      [16] spacer                       (describe-below placeholder)
      [17] Heading 2  "Actual Problem what should be solved"
      [18] Normal     "Describe the Problem ..."
      [19-22] spacers                   (content area)
      [23] Heading 2  "Solution Description"
      [24] Normal     "Describe how could the solution ..."
      [25-27] spacers                   (content area)
      [28] Heading 1  "Solution Design"
      [29] spacer
      [30] Heading 2  "Development System"
      [31] spacer                       (before Table 2)
          TABLE 2 -- Dev System checkboxes (7 rows x 3 cols)
      [32] spacer                       (after Table 2)
      [33] Heading 2  "Technical Details"
      [34] Normal     "Describe all objects ..."
      [35-41] spacers                   (content area)
      [42] Heading 2  "Names and Language"
      [43] Normal     "If you create new fields ..."
      [44-45] spacers                   (content area)
      [46] Heading 2  "Authorization"
      [47] Normal     "Consider special authorization objects ..."
      [48-50] spacers                   (content area)
    """
    doc = Document(TEMPLATE_PATH)
    paras = doc.paragraphs  # snapshot -- element refs stay valid after edits

    process_table = doc.tables[0]
    user_table = doc.tables[1]
    dev_table = doc.tables[2]

    # ================================================================
    # 1. USER STORY (paras 3-5)
    # ================================================================
    user_story = data.get("userStory", {})
    role = user_story.get("role", "").strip()
    want = user_story.get("want", "").strip()
    ability = user_story.get("ability", "").strip()

    if role:
        _set_para_text(paras[3], f"I as a {role}")
    if want:
        _set_para_text(paras[4], f"want to {want}")
    if ability:
        _set_para_text(paras[5], f"to be able to {ability}")

    # ================================================================
    # 2. PROCESS -- Table 0 checkboxes (per-column to avoid "Other" clash)
    # ================================================================
    process = data.get("process", {})
    _toggle_column_checkboxes(process_table, {
        0: process.get("function", {}).get("selected", []),
        1: process.get("processArea", {}).get("selected", []),
        2: process.get("processSubArea", {}).get("selected", []),
    }, header_row=True)

    # Remove the instruction hint paragraph [10]
    _remove_paragraph(paras[10])

    # Process custom "Other" text and describe-below
    custom_fn = process.get("function", {}).get("other", "").strip()
    custom_pa = process.get("processArea", {}).get("other", "").strip()
    process_desc = process.get("describeBelow", "").strip()

    has_other = custom_fn or custom_pa or process_desc
    if has_other:
        parts = []
        if custom_fn:
            parts.append(f"Function Other: {custom_fn}")
        if custom_pa:
            parts.append(f"Area Other: {custom_pa}")
        if process_desc:
            parts.append(process_desc)
        _set_para_text(paras[11], "Other: " + "  |  ".join(parts))
    else:
        _remove_paragraph(paras[11])

    # ================================================================
    # 3. USER -- Table 1 checkboxes (flat list, no header row)
    # ================================================================
    user_section = data.get("user", {})
    _toggle_table_checkboxes(user_table, user_section.get("selected", []), header_row=False)

    # Remove the instruction hint paragraph [15]
    _remove_paragraph(paras[15])

    # User custom "Other" text and describe-below
    user_other = user_section.get("other", "").strip()
    user_desc = user_section.get("describeBelow", "").strip()

    has_user_other = user_other or user_desc
    if has_user_other:
        parts = []
        if user_other:
            parts.append(user_other)
        if user_desc:
            parts.append(user_desc)
        _set_para_text(paras[16], "Other: " + "  |  ".join(parts))
    else:
        _remove_paragraph(paras[16])

    # ================================================================
    # 4. PROBLEM DESCRIPTION (para 18 = instruction, 19 = first content slot)
    # ================================================================
    _remove_paragraph(paras[18])  # Remove "Describe the Problem ..." instruction

    problem_text = data.get("problemDescription", "").strip()
    if problem_text:
        _set_para_text(paras[19], problem_text)
        for p in [paras[22], paras[21], paras[20]]:
            _remove_paragraph(p)

    problem_ref = paras[19]._element
    _insert_images_after(doc, problem_ref, problem_images)

    # ================================================================
    # 5. SOLUTION DESCRIPTION (para 24 = instruction, 25 = content slot)
    # ================================================================
    _remove_paragraph(paras[24])  # Remove "Describe how could the solution ..." instruction

    solution_text = data.get("solutionDescription", "").strip()
    if solution_text:
        _set_para_text(paras[25], solution_text)
        for p in [paras[27], paras[26]]:
            _remove_paragraph(p)

    solution_ref = paras[25]._element
    _insert_images_after(doc, solution_ref, solution_images)

    # ================================================================
    # 6. DEVELOPMENT SYSTEM -- Table 2 checkboxes (per-column)
    # ================================================================
    dev_system = data.get("developmentSystem", {})
    _toggle_column_checkboxes(dev_table, {
        0: dev_system.get("erp", {}).get("selected", []),
        1: dev_system.get("scm", {}).get("selected", []),
        2: dev_system.get("cloud", {}).get("selected", []),
    }, header_row=True)

    custom_erp = dev_system.get("erp", {}).get("other", "").strip()
    custom_scm = dev_system.get("scm", {}).get("other", "").strip()
    custom_cloud = dev_system.get("cloud", {}).get("other", "").strip()
    if custom_erp or custom_scm or custom_cloud:
        parts = []
        if custom_erp:
            parts.append(f"ERP: {custom_erp}")
        if custom_scm:
            parts.append(f"SCM: {custom_scm}")
        if custom_cloud:
            parts.append(f"Cloud: {custom_cloud}")
        _set_para_text(paras[32], "Other: " + "  |  ".join(parts))

    # ================================================================
    # 7. TECHNICAL DETAILS (para 34 = instruction, 35 = content slot)
    # ================================================================
    _remove_paragraph(paras[34])  # Remove "Describe all objects ..." instruction

    tech_text = data.get("technicalDetails", "").strip()
    if tech_text:
        _set_para_text(paras[35], tech_text)
        for p in [paras[41], paras[40], paras[39], paras[38], paras[37], paras[36]]:
            _remove_paragraph(p)

    # ================================================================
    # 8. NAMES AND LANGUAGE (para 43 = instruction, 44 = content slot)
    # ================================================================
    _remove_paragraph(paras[43])  # Remove "If you create new fields ..." instruction

    names_text = data.get("namesAndLanguage", "").strip()
    if names_text:
        _set_para_text(paras[44], names_text)
        _remove_paragraph(paras[45])

    # ================================================================
    # 9. AUTHORIZATION (para 47 = instruction, 48 = content slot)
    # ================================================================
    _remove_paragraph(paras[47])  # Remove "Consider special authorization ..." instruction

    auth_text = data.get("authorization", "").strip()
    if auth_text:
        _set_para_text(paras[48], auth_text)
        for p in [paras[50], paras[49]]:
            _remove_paragraph(p)

    # -- Write to buffer --
    buffer = io.BytesIO()
    doc.save(buffer)
    buffer.seek(0)
    return buffer


# ─── Business Requirement generator ───────────────────────

def _set_table_cell(table, row_idx, col_idx, text: str):
    """Set text in a specific table cell, preserving first run formatting."""
    cell = table.rows[row_idx].cells[col_idx]
    if cell.paragraphs and cell.paragraphs[0].runs:
        cell.paragraphs[0].runs[0].text = text
    else:
        cell.paragraphs[0].text = text


def _append_text_after_heading(doc, heading_para, text: str):
    """Insert a new paragraph with text right after a heading paragraph."""
    new_p = OxmlElement("w:p")
    new_r = OxmlElement("w:r")

    # Match document default font
    rpr = OxmlElement("w:rPr")
    sz = OxmlElement("w:sz")
    sz.set(qn("w:val"), "22")  # 11pt
    rpr.append(sz)
    new_r.append(rpr)

    new_t = OxmlElement("w:t")
    new_t.set(qn("xml:space"), "preserve")
    new_t.text = text
    new_r.append(new_t)
    new_p.append(new_r)

    heading_para._element.addnext(new_p)
    return new_p


def generate_br_docx(data: dict) -> io.BytesIO:
    """
    Fill the BSH Business Requirement template with form data.
    Returns an in-memory BytesIO buffer ready for streaming.

    Template structure (Business_requirement_template.docx):
      Paragraphs:
        [ 0] "* indicates a mandatory field"
        [ 5] Heading 1 "Business Requirement Description *"
        [ 6] Heading 2 "What is the initial situation?"
        [ 7] Heading 2 "What is the required situation?"
        [ 8] Heading 2 "Who is involved in the function/process (departments)?"
        [ 9] Heading 2 "Which IT-components are used …?"
        [10] Heading 2 "What data is used or affected?"
        [11] Heading 2 "What is your proposal for solution?"
        [13] Heading 1 "Benefits for the Business"
        [14] Heading 2 "What benefits can be reached?"
        [15] Heading 2 "What are your savings p.a.?"
        [16] Heading 2 "What would happen without the implementation?"

      Tables:
        Table 0 (4x4): Header info (title, project, product owner, IT product, target date, requestor, company)
        Table 2 (5x4): Responsibles (Local Business, Global Business, Global Shape GDS, Regional Shape GDS)
    """
    doc = Document(BR_TEMPLATE_PATH)
    paras = doc.paragraphs
    tables = doc.tables

    # ================================================================
    # 1. HEADER TABLE (Table 0)
    # ================================================================
    header_table = tables[0]

    # Row 0: Requirement Title (merged across all 4 cols → set col 0)
    title = data.get("title", "").strip()
    if title:
        # The title row cells are merged; set the first cell
        _set_table_cell(header_table, 0, 0, title)

    # Row 1: Project (col 1), Product Owner (col 3)
    project = data.get("project", "").strip()
    product_owner = data.get("productOwner", "").strip()
    if project:
        _set_table_cell(header_table, 1, 1, project)
    if product_owner:
        _set_table_cell(header_table, 1, 3, product_owner)

    # Row 2: IT Product (col 1), Target Date (col 3)
    it_product = data.get("itProduct", "").strip()
    target_date = data.get("targetDate", "").strip()
    if it_product:
        _set_table_cell(header_table, 2, 1, it_product)
    if target_date:
        _set_table_cell(header_table, 2, 3, target_date)

    # Row 3: Requestor (col 1), Requestor Company (col 3)
    requestor = data.get("requestor", "").strip()
    requestor_company = data.get("requestorCompany", "").strip()
    if requestor:
        _set_table_cell(header_table, 3, 1, requestor)
    if requestor_company:
        _set_table_cell(header_table, 3, 3, requestor_company)

    # ================================================================
    # DOCUMENT HEADER (page header) – Create Date & Created By
    # ================================================================
    create_date = data.get("createDate", "").strip()
    created_by = data.get("createdBy", "").strip()
    if create_date or created_by:
        hdr_table = doc.sections[0].header.tables[0]
        cell = hdr_table.cell(0, 2)
        para = cell.paragraphs[0]
        # The cell has 2 runs: "Create Date: " and "\nCreated by: "
        runs = para.runs
        if len(runs) >= 2:
            runs[0].text = f"Create Date: {create_date}"
            runs[1].text = f"\nCreated by: {created_by}"

    # ================================================================
    # 2. RESPONSIBLES TABLE (Table 2)
    # ================================================================
    resp_table = tables[2]
    responsibles = data.get("responsibles", {})

    # Row mapping: 1=Local Business, 2=Global Business, 3=Global Shape GDS, 4=Regional Shape GDS
    # Columns: 0=Role, 1=eMail, 2=Company, 3=Department
    resp_map = {
        1: "localBusiness",
        2: "globalBusiness",
        3: "globalShapeGds",
        4: "regionalShapeGds",
    }

    for row_idx, key in resp_map.items():
        entry = responsibles.get(key, {})
        email = entry.get("email", "").strip()
        company = entry.get("company", "").strip()
        dept = entry.get("department", "").strip()
        if email:
            _set_table_cell(resp_table, row_idx, 1, email)
        if company:
            _set_table_cell(resp_table, row_idx, 2, company)
        if dept:
            _set_table_cell(resp_table, row_idx, 3, dept)

    # ================================================================
    # 3. BUSINESS REQUIREMENT DESCRIPTION (paras 6-11)
    # ================================================================
    description = data.get("description", {})

    field_map = {
        6: "initialSituation",
        7: "requiredSituation",
        8: "departments",
        9: "itComponents",
        10: "dataAffected",
        11: "proposalSolution",
    }

    for para_idx, field_key in field_map.items():
        text = description.get(field_key, "").strip()
        if text:
            _append_text_after_heading(doc, paras[para_idx], text)

    # ================================================================
    # 4. BENEFITS (paras 14-16)
    # ================================================================
    benefits = data.get("benefits", {})

    benefits_map = {
        14: "benefitsReached",
        15: "savingsPA",
        16: "withoutImplementation",
    }

    for para_idx, field_key in benefits_map.items():
        text = benefits.get(field_key, "").strip()
        if text:
            _append_text_after_heading(doc, paras[para_idx], text)

    # ================================================================
    # 5. SIGN OFF / AGREEMENT (Table 3)
    #    Row 0: header (Agreement, Name, Department, Date, Signature)
    #    Row 1: Global Business Process Owner
    #    Row 2: GDS Product Owner / Manager
    # ================================================================
    sign_off = data.get("signOff", {})
    signoff_table = tables[3]

    gbpo = sign_off.get("gbpo", {})
    if gbpo.get("name", "").strip():
        _set_table_cell(signoff_table, 1, 1, gbpo["name"].strip())
    if gbpo.get("department", "").strip():
        _set_table_cell(signoff_table, 1, 2, gbpo["department"].strip())
    if gbpo.get("date", "").strip():
        _set_table_cell(signoff_table, 1, 3, gbpo["date"].strip())

    gds = sign_off.get("gds", {})
    if gds.get("name", "").strip():
        _set_table_cell(signoff_table, 2, 1, gds["name"].strip())
    if gds.get("department", "").strip():
        _set_table_cell(signoff_table, 2, 2, gds["department"].strip())
    if gds.get("date", "").strip():
        _set_table_cell(signoff_table, 2, 3, gds["date"].strip())

    # ================================================================
    # 6. COST ESTIMATION & DECISION
    # ================================================================
    decision = data.get("decision", {})

    # Table 5: Evaluation (single-cell table)
    evaluation = decision.get("evaluation", "").strip()
    if evaluation:
        cell = tables[5].rows[0].cells[0]
        existing = cell.text.strip()
        cell.paragraphs[0].text = existing
        # Add answer on new line
        p = cell.add_paragraph()
        run = p.add_run(evaluation)
        run.font.size = Pt(11)

    # Table 6: Decision date (single-cell table)
    decision_date = decision.get("decisionDate", "").strip()
    if decision_date:
        cell = tables[6].rows[0].cells[0]
        existing = cell.text.strip()
        cell.paragraphs[0].text = f"{existing} {decision_date}"

    # Table 7: Decision type — custom bigger checkboxes in column 0
    decision_type = decision.get("decisionType", "").strip()
    accepted_sub = decision.get("acceptedSubOptions", [])

    # Table structure:
    #   Row 0: rejected           (main option)
    #   Row 1: accepted           (main option)
    #   Row 2: add-on to BSH     (sub-option of accepted)
    #   Row 3: only local         (sub-option of accepted)
    #   Row 4: accepted w/ restr  (main option)
    #
    # For all 5 rows: put custom checkbox in col 0 (☐ or ☒)
    decision_table = tables[7]
    decision_check_map = {
        0: decision_type == "rejected",
        1: decision_type == "accepted",
        2: decision_type == "accepted" and "add-on" in accepted_sub,
        3: decision_type == "accepted" and "local-only" in accepted_sub,
        4: decision_type == "accepted-with-restrictions",
    }
    for row_idx in range(5):
        checked = decision_check_map.get(row_idx, False)
        _set_custom_checkbox(decision_table, row_idx, 0, checked)

    # Table 8: Specification of restrictions (single-cell table)
    restrictions = decision.get("restrictions", "").strip()
    if restrictions:
        cell = tables[8].rows[0].cells[0]
        existing = cell.text.strip()
        cell.paragraphs[0].text = existing
        p = cell.add_paragraph()
        run = p.add_run(restrictions)
        run.font.size = Pt(11)

    # Table 9: Reason for decision (single-cell table)
    reason = decision.get("reason", "").strip()
    if reason:
        cell = tables[9].rows[0].cells[0]
        existing = cell.text.strip()
        cell.paragraphs[0].text = existing
        p = cell.add_paragraph()
        run = p.add_run(reason)
        run.font.size = Pt(11)

    # Table 10: Target date in case of implementation (single-cell table)
    impl_target_date = decision.get("implTargetDate", "").strip()
    if impl_target_date:
        cell = tables[10].rows[0].cells[0]
        existing = cell.text.strip()
        cell.paragraphs[0].text = f"{existing} {impl_target_date}"

    # ================================================================
    # 7. COSTS / SAVINGS / CHARGING (Table 12)
    #    Row 0: headers
    #    Rows 1-3: data rows
    #    Row 4: totals
    # ================================================================
    costs = data.get("costs", {})
    cost_rows = costs.get("rows", [])
    cost_table = tables[12]

    total_initial = 0
    total_running = 0
    total_savings = 0
    total_payback = 0
    period_sum = 0
    period_count = 0

    for i, cr in enumerate(cost_rows[:3]):
        row_idx = i + 1  # data rows start at 1
        it_prod = cr.get("itProduct", "").strip()
        catsnr = cr.get("catsnr", "").strip()
        initial = cr.get("initialCosts", "").strip()
        running = cr.get("runningCosts", "").strip()
        savings_val = cr.get("savings", "").strip()

        if it_prod:
            _set_table_cell(cost_table, row_idx, 0, it_prod)
        if catsnr:
            _set_table_cell(cost_table, row_idx, 1, catsnr)

        initial_f = float(initial) if initial else 0
        running_f = float(running) if running else 0
        savings_f = float(savings_val) if savings_val else 0

        if initial:
            _set_table_cell(cost_table, row_idx, 2, initial)
        if running:
            _set_table_cell(cost_table, row_idx, 3, running)
        if savings_val:
            _set_table_cell(cost_table, row_idx, 4, savings_val)

        payback = savings_f - running_f
        _set_table_cell(cost_table, row_idx, 5, f"{payback:.0f}" if (initial or running or savings_val) else "-")

        if payback > 0:
            period = initial_f / payback
            _set_table_cell(cost_table, row_idx, 6, f"{period:.1f}")
            period_sum += period
            period_count += 1
        else:
            _set_table_cell(cost_table, row_idx, 6, "-")

        total_initial += initial_f
        total_running += running_f
        total_savings += savings_f
        total_payback += payback

    # Fill totals row (row 4)
    has_data = total_initial or total_running or total_savings
    if has_data:
        _set_table_cell(cost_table, 4, 2, f"{total_initial:.0f}")
        _set_table_cell(cost_table, 4, 3, f"{total_running:.0f}")
        _set_table_cell(cost_table, 4, 4, f"{total_savings:.0f}")
        _set_table_cell(cost_table, 4, 5, f"{total_payback:.0f}")
        _set_table_cell(cost_table, 4, 6, f"{period_sum / period_count:.1f}" if period_count else "-")

    # -- Write to buffer --
    buffer = io.BytesIO()
    doc.save(buffer)
    buffer.seek(0)
    return buffer


def _set_custom_checkbox(table, row_idx, col_idx, checked: bool):
    """
    Replace the content of a cell with a large custom checkbox character.
    ☒ (checked) or ☐ (unchecked), rendered at 16pt for visibility.
    Clears any existing content/borders in the cell first.
    """
    char = "\u2612" if checked else "\u2610"
    cell = table.rows[row_idx].cells[col_idx]

    # Clear all existing paragraphs
    for p in cell.paragraphs:
        for run in p.runs:
            run.text = ""

    # Set the checkbox character in the first paragraph
    para = cell.paragraphs[0]
    if para.runs:
        run = para.runs[0]
    else:
        run = para.add_run()

    run.text = char
    run.font.size = Pt(16)
    run.font.bold = True
    run.font.color.rgb = RGBColor(0x33, 0x33, 0x33)

    # Center the character
    para.alignment = WD_ALIGN_PARAGRAPH.CENTER
