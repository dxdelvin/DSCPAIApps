import json
import os
import ssl
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
TEMPLATES_DIR = BASE_DIR / "templates"
STATIC_DIR = BASE_DIR / "static"
APP_TITLE = "BSH"

# CSS Versioning - Update this to force cache refresh on CSS changes
CSS_VERSION = "3.4.8"

# Environment Configuration
IS_PRODUCTION = os.getenv("ENVIRONMENT", "dev").lower() == "prod"
APP_ENV = "prod" if IS_PRODUCTION else "dev"
CLIENT_LOGGING_ENABLED = os.getenv("CLIENT_LOGGING_ENABLED", "true").lower() == "true"
CLIENT_LOG_LEVEL = os.getenv("CLIENT_LOG_LEVEL", "error" if IS_PRODUCTION else "debug").lower()

# Brain API Configuration
BRAIN_API_BASE_URL = os.getenv("BRAIN_API_BASE_URL", "https://ews-emea.api.bosch.com:443/it/application/dia-brain/v1/api")


def get_ssl_context():
    """Build an SSL context for outgoing HTTPS requests.

    Corporate environments (SAP BTP / Bosch proxy) often use internal CAs that
    are not in the default certifi bundle.  Set the ``SSL_CA_BUNDLE`` env var to
    point at a PEM file that contains the full chain, or set
    ``SSL_VERIFY=false`` **only** in trusted dev environments behind VPN.

    Returns ``ssl.SSLContext | bool``:
      - In production: always a proper SSLContext (with optional custom CA).
      - In dev with ``SSL_VERIFY=false``: returns ``False`` (disables verification).
    """
    if os.getenv("SSL_VERIFY", "true").lower() == "false" and not IS_PRODUCTION:
        return False

    ca_bundle = os.getenv("SSL_CA_BUNDLE")
    if ca_bundle and os.path.isfile(ca_bundle):
        ctx = ssl.create_default_context(cafile=ca_bundle)
        return ctx

    return True


def get_object_store_config() -> dict:
    """Return Object Store (S3-compatible) credentials.

    In production (Cloud Foundry / SAP BTP), credentials are automatically
    injected by the platform via ``VCAP_SERVICES`` when the service instance
    ``DSCP_APPS_Object_DB`` is bound in manifest.yml.

    For local development, set these environment variables (copy values from
    the BTP Cockpit service key JSON):
        OBJECT_STORE_HOST, OBJECT_STORE_BUCKET,
        OBJECT_STORE_ACCESS_KEY_ID, OBJECT_STORE_SECRET_ACCESS_KEY,
        OBJECT_STORE_REGION

    Returns a dict with keys: host, bucket, access_key_id, secret_access_key, region.
    Returns None when credentials are unavailable (silently disables history in dev).
    Raises RuntimeError in production when credentials are missing.
    """
    vcap_raw = os.getenv("VCAP_SERVICES")
    if vcap_raw:
        try:
            vcap = json.loads(vcap_raw)
            creds_list = vcap.get("objectstore", [])
            if creds_list:
                creds = creds_list[0]["credentials"]
                return {
                    "host": creds["host"],
                    "bucket": creds["bucket"],
                    "access_key_id": creds["access_key_id"],
                    "secret_access_key": creds["secret_access_key"],
                    "region": creds.get("region", "eu-central-1"),
                }
        except (KeyError, IndexError, json.JSONDecodeError):
            pass

    # Local dev fallback — individual env vars
    host = os.getenv("OBJECT_STORE_HOST")
    bucket = os.getenv("OBJECT_STORE_BUCKET")
    access_key = os.getenv("OBJECT_STORE_ACCESS_KEY_ID")
    secret_key = os.getenv("OBJECT_STORE_SECRET_ACCESS_KEY")
    region = os.getenv("OBJECT_STORE_REGION", "eu-central-1")

    if host and bucket and access_key and secret_key:
        return {
            "host": host,
            "bucket": bucket,
            "access_key_id": access_key,
            "secret_access_key": secret_key,
            "region": region,
        }

    if IS_PRODUCTION:
        raise RuntimeError(
            "Object Store credentials are missing. "
            "Ensure DSCP_APPS_Object_DB is bound in manifest.yml and the app is restaged."
        )

    return None
