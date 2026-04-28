"""Secure user ID sanitization for S3 object keys."""
import re
from typing import Optional


_SAFE_CHARS_RE = re.compile(r"[^a-zA-Z0-9._\-]")


def safe_user_id(user_id: Optional[str]) -> str:
    """Sanitise a user identifier so it is safe to embed in an S3 object key.

    Replaces every character that is not alphanumeric, dot, dash, or underscore
    with an underscore and truncates to 64 characters.  This preserves the same
    key paths used by the original per-service history code so that data already
    stored in the object store remains accessible after the refactor.
    """
    sanitised = _SAFE_CHARS_RE.sub("_", user_id or "anonymous")
    return sanitised[:64] or "anonymous"


def validate_user_id(user_id: str) -> str:
    """Validate and normalize a user ID before use."""
    if not user_id:
        raise ValueError("User ID cannot be empty")
    
    user_id = user_id.strip()
    
    if not user_id:
        raise ValueError("User ID cannot be only whitespace")
    
    if len(user_id) > 256:
        raise ValueError("User ID is too long (max 256 characters)")
    
    if ".." in user_id or "/" in user_id or "\\" in user_id:
        raise ValueError("User ID contains invalid characters")
    
    return user_id
