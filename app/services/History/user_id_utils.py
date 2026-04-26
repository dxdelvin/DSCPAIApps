"""Secure user ID sanitization for S3 object keys."""
import hashlib
import re
from typing import Optional


_SAFE_CHARS_RE = re.compile(r"[^a-zA-Z0-9._\-]")


def safe_user_id(user_id: Optional[str]) -> str:
    """Generate a safe, unique identifier for S3 object keys from a user ID."""
    if not user_id or not user_id.strip():
        return "anonymous"
    
    user_id = user_id.strip().lower()
    
    hash_bytes = hashlib.sha256(user_id.encode("utf-8")).digest()
    hash_suffix = hash_bytes.hex()[:8]
    
    prefix = _SAFE_CHARS_RE.sub("_", user_id)[:24].rstrip("_")
    if not prefix:
        prefix = "user"
    
    return f"{prefix}_{hash_suffix}"


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
