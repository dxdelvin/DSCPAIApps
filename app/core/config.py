import os
import ssl
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
TEMPLATES_DIR = BASE_DIR / "templates"
STATIC_DIR = BASE_DIR / "static"
APP_TITLE = "BSH"

# CSS Versioning - Update this to force cache refresh on CSS changes
CSS_VERSION = "3.3.1"

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
