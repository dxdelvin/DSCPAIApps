import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
TEMPLATES_DIR = BASE_DIR / "templates"
STATIC_DIR = BASE_DIR / "static"
APP_TITLE = "BSH"

# Environment Configuration
IS_PRODUCTION = os.getenv("ENVIRONMENT", "dev").lower() == "prod"

# Brain API Configuration
BRAIN_API_BASE_URL = os.getenv("BRAIN_API_BASE_URL", "https://ews-emea.api.bosch.com:443/it/application/dia-brain/v1/api")
