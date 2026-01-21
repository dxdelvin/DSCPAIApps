import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
TEMPLATES_DIR = BASE_DIR / "templates"
STATIC_DIR = BASE_DIR / "static"
APP_TITLE = "BSH"

# SAP BTP Connectivity Configuration
USE_SAP_CONNECTIVITY = os.getenv("USE_SAP_CONNECTIVITY", "false").lower() == "true"
DESTINATION_NAME = os.getenv("DESTINATION_NAME", "BRAIN_API")

# Brain API Configuration (used when not in BTP or as fallback)
BRAIN_API_BASE_URL = os.getenv("BRAIN_API_BASE_URL", "https://ews-emea.api.bosch.com:443/it/application/dia-brain/v1/api")
