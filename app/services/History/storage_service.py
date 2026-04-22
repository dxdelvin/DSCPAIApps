"""
S3-compatible Object Store client for SAP BTP (DSCP_APPS_Object_DB).
Uses boto3 against the AWS S3-compatible endpoint provided by BTP.
All I/O is wrapped in asyncio.to_thread so callers can await it.
"""
import asyncio
import logging
import re

from app.core.config import get_object_store_config

logger = logging.getLogger(__name__)

_KEY_UNSAFE_RE = re.compile(r"\.\.")  # block path-traversal fragments


def _validate_key(key: str) -> None:
    """Raise ValueError for keys that contain path-traversal sequences."""
    if _KEY_UNSAFE_RE.search(key):
        raise ValueError(f"Invalid object key: {key!r}")
    if key.startswith("/"):
        raise ValueError(f"Object key must not start with '/': {key!r}")


def _make_client():
    """Return a boto3 S3 client configured for BTP Object Store.

    Returns None when credentials are unavailable (local dev without config).
    """
    cfg = get_object_store_config()
    if cfg is None:
        return None, None

    try:
        import boto3
        from botocore.config import Config as BotoCfg

        endpoint = cfg["host"]
        if not endpoint.startswith("http"):
            endpoint = f"https://{endpoint}"

        client = boto3.client(
            "s3",
            region_name=cfg["region"],
            endpoint_url=endpoint,
            aws_access_key_id=cfg["access_key_id"],
            aws_secret_access_key=cfg["secret_access_key"],
            config=BotoCfg(signature_version="s3v4"),
        )
        return client, cfg["bucket"]
    except Exception:
        logger.exception("Failed to create Object Store client")
        return None, None


async def put_object(key: str, body: bytes, content_type: str = "application/octet-stream") -> bool:
    """Upload bytes to the Object Store bucket.

    Returns True on success, False when storage is unavailable (no crash).
    """
    _validate_key(key)

    def _upload():
        client, bucket = _make_client()
        if client is None:
            return False
        client.put_object(
            Bucket=bucket,
            Key=key,
            Body=body,
            ContentType=content_type,
            ServerSideEncryption="AES256",
        )
        return True

    try:
        return await asyncio.to_thread(_upload)
    except Exception:
        logger.exception("Object Store put_object failed for key=%r", key)
        return False


async def get_object(key: str) -> bytes | None:
    """Download bytes from the Object Store bucket.

    Returns None when the object does not exist or storage is unavailable.
    """
    _validate_key(key)

    def _download():
        client, bucket = _make_client()
        if client is None:
            return None
        try:
            resp = client.get_object(Bucket=bucket, Key=key)
            return resp["Body"].read()
        except client.exceptions.NoSuchKey:
            return None
        except Exception:
            raise

    try:
        return await asyncio.to_thread(_download)
    except Exception:
        logger.exception("Object Store get_object failed for key=%r", key)
        return None


async def delete_object(key: str) -> bool:
    """Delete an object from the bucket. Returns True on success."""
    _validate_key(key)

    def _delete():
        client, bucket = _make_client()
        if client is None:
            return False
        client.delete_object(Bucket=bucket, Key=key)
        return True

    try:
        return await asyncio.to_thread(_delete)
    except Exception:
        logger.exception("Object Store delete_object failed for key=%r", key)
        return False
