import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
TEMPLATES_DIR = BASE_DIR / "templates"
STATIC_DIR = BASE_DIR / "static"
APP_TITLE = "BSH"

# CSS Versioning - Update this to force cache refresh on CSS changes
CSS_VERSION = "3.1.0"

# Environment Configuration
IS_PRODUCTION = os.getenv("ENVIRONMENT", "dev").lower() == "prod"
APP_ENV = "prod" if IS_PRODUCTION else "dev"
CLIENT_LOGGING_ENABLED = os.getenv("CLIENT_LOGGING_ENABLED", "true").lower() == "true"
CLIENT_LOG_LEVEL = os.getenv("CLIENT_LOG_LEVEL", "error" if IS_PRODUCTION else "debug").lower()

# Brain API Configuration
BRAIN_API_BASE_URL = os.getenv("BRAIN_API_BASE_URL", "https://ews-emea.api.bosch.com:443/it/application/dia-brain/v1/api")
