import io
import json
import unittest
from unittest.mock import AsyncMock, Mock, patch

from fastapi import UploadFile
from fastapi.testclient import TestClient

from app.main import app
from app.services.confluence_builder_service import (
    _extract_pdf_text,
    build_draft_reference_state,
    extract_confluence_error_message,
    parse_upload_manifest,
)


def make_upload_file(name: str, content: bytes = b"demo", content_type: str = "application/octet-stream") -> UploadFile:
    return UploadFile(filename=name, file=io.BytesIO(content), headers={"content-type": content_type})


class ConfluenceBuilderHelperTests(unittest.TestCase):
    def test_parse_upload_manifest_assigns_display_slots_and_dedupes_attachment_names(self):
        files = [
            make_upload_file("overview.png"),
            make_upload_file("notes.docx"),
            make_upload_file("notes.docx"),
        ]
        manifest = json.dumps(
            [
                {"id": "img-1", "useForAi": True, "attachToPage": True, "displayInPage": True, "displayOrder": 3},
                {"id": "doc-1", "useForAi": False, "attachToPage": True, "displayInPage": False},
                {"id": "doc-2", "useForAi": False, "attachToPage": True, "displayInPage": False},
            ]
        )

        plan, errors = parse_upload_manifest(files, manifest)

        self.assertEqual(errors, [])
        self.assertIsNotNone(plan)
        assert plan is not None
        self.assertEqual(plan[0]["canonicalName"], "display-image-01.png")
        self.assertEqual(plan[1]["canonicalName"], "notes.docx")
        self.assertEqual(plan[2]["canonicalName"], "notes (2).docx")

    def test_parse_upload_manifest_rejects_more_than_ten_display_images(self):
        files = [make_upload_file(f"image-{index}.png") for index in range(11)]
        manifest = json.dumps(
            [
                {
                    "id": f"img-{index}",
                    "useForAi": True,
                    "attachToPage": True,
                    "displayInPage": True,
                    "displayOrder": index + 1,
                }
                for index in range(11)
            ]
        )

        plan, errors = parse_upload_manifest(files, manifest)

        self.assertIsNone(plan)
        self.assertTrue(any("at most 10 display images" in error for error in errors))

    def test_build_draft_reference_state_reports_unknown_references_and_missing_display_image(self):
        file_plan = [
            {
                "sourceId": "img-1",
                "originalName": "overview.png",
                "canonicalName": "display-image-01.png",
                "attachToPage": True,
                "displayInPage": True,
                "useForAi": True,
                "displayOrder": 1,
            },
            {
                "sourceId": "doc-1",
                "originalName": "guide.docx",
                "canonicalName": "guide.docx",
                "attachToPage": True,
                "displayInPage": False,
                "useForAi": False,
                "displayOrder": None,
            },
        ]
        storage_xml = '<p><ac:link><ri:attachment ri:filename="guide.docx" /></ac:link></p><p><ac:link><ri:attachment ri:filename="ghost.docx" /></ac:link></p>'

        attachments, display_images, warnings = build_draft_reference_state(file_plan, storage_xml)

        self.assertEqual(len(attachments), 2)
        self.assertEqual(len(display_images), 1)
        self.assertFalse(display_images[0]["usedInXml"])
        self.assertTrue(any("ghost.docx" in warning for warning in warnings))
        self.assertTrue(any("display-image-01.png" in warning for warning in warnings))

    @patch("PyPDF2.PdfReader")
    def test_extract_pdf_text_reads_mocked_pdf_pages(self, reader_cls: Mock):
        page = Mock()
        page.extract_text.return_value = "First page content"
        reader = Mock()
        reader.pages = [page]
        reader_cls.return_value = reader

        text, error = _extract_pdf_text(b"pdf-bytes")

        self.assertIsNone(error)
        self.assertIn("First page content", text)

    def test_extract_confluence_error_message_prefers_message_field(self):
        message = extract_confluence_error_message(
            json.dumps({"message": "title already exists in this space"}),
            400,
        )

        self.assertEqual(message, "title already exists in this space")


class ConfluenceBuilderApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(app)

    def test_generate_endpoint_returns_success_payload(self):
        with patch(
            "app.routers.api.generate_confluence_builder_draft",
            new=AsyncMock(
                return_value={
                    "chatHistoryId": "chat-1",
                    "title": "Generated Title",
                    "summary": "Draft summary",
                    "storageXml": "<p>Hello</p>",
                    "attachmentReferences": [],
                    "displayImages": [],
                    "warnings": [],
                }
            ),
        ):
            response = self.client.post(
                "/api/confluence-builder/generate",
                files=[("files", ("source.pdf", b"pdf-bytes", "application/pdf"))],
                data={
                    "uploadManifest": json.dumps(
                        [{"id": "file-1", "name": "source.pdf", "useForAi": True, "attachToPage": True, "displayInPage": False, "displayOrder": None}]
                    ),
                    "requestedTitle": "",
                    "instructions": "Keep it concise",
                },
            )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["status"], "success")
        self.assertEqual(payload["title"], "Generated Title")

    def test_refine_endpoint_returns_success_payload(self):
        with patch(
            "app.routers.api.refine_confluence_builder_draft",
            new=AsyncMock(
                return_value={
                    "chatHistoryId": "chat-2",
                    "title": "Refined Title",
                    "summary": "Refined summary",
                    "storageXml": "<p>Updated</p>",
                    "attachmentReferences": [],
                    "displayImages": [],
                    "warnings": [],
                }
            ),
        ):
            response = self.client.post(
                "/api/confluence-builder/refine",
                json={
                    "chatHistoryId": "chat-1",
                    "instruction": "Make it shorter",
                    "draft": {
                        "title": "Original",
                        "summary": "Original summary",
                        "storageXml": "<p>Original</p>",
                        "attachmentReferences": [],
                        "displayImages": [],
                        "warnings": [],
                    },
                },
            )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["status"], "success")
        self.assertEqual(payload["title"], "Refined Title")

    def test_publish_endpoint_requires_pat(self):
        response = self.client.post(
            "/api/confluence-builder/publish",
            data={
                "uploadManifest": "[]",
                "draft": json.dumps(
                    {
                        "title": "Draft Title",
                        "summary": "Summary",
                        "storageXml": "<p>Hello</p>",
                        "attachmentReferences": [],
                        "displayImages": [],
                        "warnings": [],
                    }
                ),
                "confluenceUrl": "https://inside-docupedia.bosch.com/confluence2",
                "spaceKey": "DOC",
                "parentPageId": "12345",
                "pat": "",
            },
        )

        self.assertEqual(response.status_code, 400)
        payload = response.json()
        self.assertEqual(payload["status"], "error")
        self.assertIn("PAT", payload["message"])

    def test_publish_endpoint_returns_success_payload(self):
        with patch(
            "app.routers.api.publish_confluence_builder_page",
            new=AsyncMock(
                return_value={
                    "status": "success",
                    "pageId": "98765",
                    "title": "Draft Title",
                    "version": 1,
                    "pageLink": "https://inside-docupedia.bosch.com/confluence2/pages/viewpage.action?pageId=98765",
                    "uploadedCount": 1,
                    "failedUploadCount": 0,
                    "uploadResults": [],
                    "attachmentReferences": [],
                    "warnings": [],
                }
            ),
        ):
            response = self.client.post(
                "/api/confluence-builder/publish",
                data={
                    "uploadManifest": json.dumps(
                        [{"id": "file-1", "name": "guide.docx", "useForAi": False, "attachToPage": True, "displayInPage": False, "displayOrder": None}]
                    ),
                    "draft": json.dumps(
                        {
                            "title": "Draft Title",
                            "summary": "Summary",
                            "storageXml": "<p>Hello</p>",
                            "attachmentReferences": [],
                            "displayImages": [],
                            "warnings": [],
                        }
                    ),
                    "confluenceUrl": "https://inside-docupedia.bosch.com/confluence2",
                    "spaceKey": "DOC",
                    "parentPageId": "12345",
                    "pat": "secret-token",
                },
                files=[("files", ("guide.docx", b"doc-bytes", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"))],
            )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["status"], "success")
        self.assertEqual(payload["pageId"], "98765")


if __name__ == "__main__":
    unittest.main()
