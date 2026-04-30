"""Shared helpers and constants for API sub-routers.

These were originally inline at the top of `app/routers/api.py`.
"""
from __future__ import annotations
import logging
import re

logger = logging.getLogger(__name__)

_LOG_SANITIZE_RE = re.compile(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]')
_ALLOWED_LOG_LEVELS = {"debug", "info", "warn", "warning", "error"}
MAX_UPLOAD_SIZE = 10 * 1024 * 1024  # 10 MB

# Magic-byte signatures for allowed upload types
_FILE_MAGIC: dict[str, bytes] = {
    "pdf":  b"%PDF-",
    "png":  b"\x89PNG\r\n",
    "jpg":  b"\xff\xd8\xff",
    "jpeg": b"\xff\xd8\xff",
}


def _validate_magic(data: bytes, filename: str) -> bool:
    """Return True when the file header matches the extension-declared type."""
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    sig = _FILE_MAGIC.get(ext)
    return sig is None or data[: len(sig)] == sig


_GEN_ID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
    re.IGNORECASE,
)


def _validate_gen_id(gen_id: str) -> None:
    """Raise ValueError for malformed UUID v4 path params."""
    if not _GEN_ID_RE.match(gen_id):
        raise ValueError("Invalid generation id")
