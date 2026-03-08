
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
    "Functional_Specification_Template_en.docx",
)

BR_TEMPLATE_PATH = os.path.join(
    os.path.dirname(__file__), "..", "static", "docs",
    "Business_requirement_template.docx",
)

# XML namespace for Word 2010 checkbox SDT elements
W14_NS = "http://schemas.microsoft.com/office/word/2010/wordml"

BSH_GREY = RGBColor(0x64, 0x74, 0x8B)


# ─── Low-level helpers ────────────────────────────────────

def _set_para_text(para, text: str):
    """Replace a paragraph's text, preserving the first run's formatting."""
    if para.runs:
        for run in para.runs[1:]:
            run.text = ""
        para.runs[0].text = text
    else:
        para.add_run(text)


def _set_table_cell(table, row_idx, col_idx, text: str):
    """Write text into a table cell, preserving existing run formatting."""
    cell = table.cell(row_idx, col_idx)
    para = cell.paragraphs[0]
    if para.runs:
        para.runs[0].text = text
        for r in para.runs[1:]:
            r.text = ""
    else:
        para.add_run(text)


def _find_heading_para(doc, heading_text: str):
    """Find a paragraph whose text matches heading_text (case-insensitive prefix)."""
    target = heading_text.strip().lower()
    for p in doc.paragraphs:
        if "Heading" in p.style.name and p.text.strip().lower().startswith(target):
            return p
    return None


def _first_content_para_after(doc, heading_para):
    """Return the first non-empty Normal paragraph after a heading."""
    found = False
    for p in doc.paragraphs:
        if p._p is heading_para._p:
            found = True
            continue
        if found:
            if "Heading" in p.style.name:
                return None  # next heading reached, no content
            if p.text.strip():
                return p
    return None


# ─── Functional Specification generator ───────────────────


def generate_functional_spec_docx(data: dict) -> io.BytesIO:
    """
    Fill the BSH Functional Specification template with form data.
    Returns an in-memory BytesIO buffer ready for streaming.

    Template structure (Functional_Specification_Template_en.docx):
      Page Header Table (2x3):
        R0C2: Date / Version / Author  |  R1: Title (merged)
      Body Tables:
        Table 0 (5x4): Responsibilities - Function/Name/Date/Task
        Table 1 (4x4): Previous Steps  - Step/When/Where/Who
        Table 2 (8x2): Glossary        - Abbreviation/Description
        Table 3 (4x5): Document History - Version/Date/Actioned by/Description/Status
      Sections (Heading paragraphs):
        1.  Starting point
        1.1 (Related) project goal      -> P54
        1.2 Developer statement          (boilerplate, kept)
        2.  Solution description         -> P66
        2.1 Improvement potential        -> P70
        2.2 Delimitation of solution     -> P74
        2.3 Previous steps               -> Table 1
        3.  Solution definition
        3.1 Functionality                -> P90
        3.2 User view, dialog execution  -> P94
        3.4 Data structures              -> P111
        3.5 Data maintenance             -> P115
        3.6 Interfaces                   -> P119
        3.7 Authorization – user roles   -> P123
        3.8 Information security         -> (after P130)
        3.10 Architecture and technology -> P161
        5.  Risks                        -> P175
        6.  List of open issues          -> P179
        7.  Migration                    -> P183
        8.  Glossary                     -> Table 2
        9.  Document history             -> Table 3
    """
    doc = Document(TEMPLATE_PATH)
    tables = doc.tables

    # ================================================================
    # 1. PAGE HEADER — Title, Date, Version, Author
    # ================================================================
    title = data.get("title", "").strip()
    date_val = data.get("date", "").strip()
    version = data.get("version", "").strip()
    author = data.get("author", "").strip()

    hdr_table = doc.sections[0].header.tables[0]

    # Row 0, Col 2 has runs: "Date" \t "xx.xx.xxxx" \n "Version" \t "1.0" \n "Author" \t
    cell_r0c2 = hdr_table.cell(0, 2)
    runs = cell_r0c2.paragraphs[0].runs
    if len(runs) >= 7:
        runs[2].text = date_val or "xx.xx.xxxx"   # date value
        runs[4].text = f"\t{version}" if version else "\t1.0"  # version value
        runs[6].text = f"\t{author}"    # author value

    # Row 1 (merged): Title
    if title:
        for ci in range(3):
            cell = hdr_table.cell(1, ci)
            para = cell.paragraphs[0]
            if para.runs:
                para.runs[0].text = title
                for r in para.runs[1:]:
                    r.text = ""

    # ================================================================
    # 2. RESPONSIBILITIES TABLE (Table 0)
    # ================================================================
    resp_table = tables[0]
    responsibilities = data.get("responsibilities", {})

    resp_map = {
        1: "globalBusiness",
        2: "globalShape",
        3: "developer",
        4: "steward",
    }

    for row_idx, key in resp_map.items():
        entry = responsibilities.get(key, {})
        name = entry.get("name", "").strip()
        date_str = entry.get("date", "").strip()
        if name:
            _set_table_cell(resp_table, row_idx, 1, name)
        if date_str:
            _set_table_cell(resp_table, row_idx, 2, date_str)

    # ================================================================
    # 3. SECTION CONTENT — Replace placeholder text after headings
    # ================================================================
    # Map: (heading text prefix, data key)
    section_map = [
        ("(Related) project goal", "projectGoal"),
        ("Developer statement", "developerStatement"),
        ("Solution description", "solutionDesc"),         # Heading 1 "Solution description"
        ("Improvement potential", "improvementPotential"),
        ("Delimitation of solution", "delimitation"),
        ("Functionality", "functionality"),
        ("User view", "userView"),
        ("Language topics", "languageTopics"),
        ("Data structures", "dataStructures"),
        ("Data maintenance", "dataMaintenance"),
        ("Interfaces", "interfaces"),
        ("Authorization", "authorization"),
        ("Information security", "infoSecurity"),
        ("Architecture and technology", "architecture"),
        ("Risks", "risks"),
        ("List of open issues", "openIssues"),
        ("Migration", "migration"),
    ]

    for heading_text, data_key in section_map:
        user_text = data.get(data_key, "").strip()
        if not user_text:
            continue
        heading_para = _find_heading_para(doc, heading_text)
        if not heading_para:
            continue
        content_para = _first_content_para_after(doc, heading_para)
        if content_para:
            _set_para_text(content_para, user_text)
        else:
            # No content para exists — insert one after the heading
            new_p = OxmlElement("w:p")
            new_r = OxmlElement("w:r")
            new_t = OxmlElement("w:t")
            new_t.set(qn("xml:space"), "preserve")
            new_t.text = user_text
            new_r.append(new_t)
            new_p.append(new_r)
            heading_para._p.addnext(new_p)

    # ================================================================
    # 4. PREVIOUS STEPS TABLE (Table 1)
    # ================================================================
    prev_steps = data.get("previousSteps", [])
    prev_table = tables[1]
    for i, row_data in enumerate(prev_steps):
        if i >= 3:
            break  # template has 3 data rows (1-3)
        row_idx = i + 1
        for col_idx in range(min(len(row_data), 4)):
            val = row_data[col_idx].strip() if row_data[col_idx] else ""
            if val:
                _set_table_cell(prev_table, row_idx, col_idx, val)

    # ================================================================
    # 5. GLOSSARY TABLE (Table 2)
    # ================================================================
    glossary = data.get("glossary", [])
    glossary_table = tables[2]
    for i, row_data in enumerate(glossary):
        if i >= 7:
            break  # template has 7 data rows (1-7)
        row_idx = i + 1
        for col_idx in range(min(len(row_data), 2)):
            val = row_data[col_idx].strip() if row_data[col_idx] else ""
            if val:
                _set_table_cell(glossary_table, row_idx, col_idx, val)

    # ================================================================
    # 6. DOCUMENT HISTORY TABLE (Table 3)
    # ================================================================
    doc_history = data.get("docHistory", [])
    history_table = tables[3]
    for i, row_data in enumerate(doc_history):
        if i >= 3:
            break  # template has 3 data rows (1-3)
        row_idx = i + 1
        for col_idx in range(min(len(row_data), 5)):
            val = row_data[col_idx].strip() if row_data[col_idx] else ""
            if val:
                _set_table_cell(history_table, row_idx, col_idx, val)

    # ================================================================
    # 7. FOOTER — update title in footer
    # ================================================================
    if title:
        footer = doc.sections[0].footer
        if footer and not footer.is_linked_to_previous:
            for p in footer.paragraphs:
                if "Business Requirement" in p.text or "XXXX" in p.text:
                    _set_para_text(p, f"\t\t\n{title}\tPage 1\tDate of printing: ")

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
