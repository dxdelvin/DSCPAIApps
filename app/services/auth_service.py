import os
from fastapi import HTTPException, Security
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sap import xssec
from cfenv import AppEnv

# Security Scheme
security = HTTPBearer()

# Load Service Credentials
env = AppEnv()
uaa_service = env.get_service(name='dscp-ai-app')

def get_current_user(credentials: HTTPAuthorizationCredentials = Security(security)):
    """
    Validates the SAP JWT Token.
    """
    # 1. Check if XSUAA is missing
    if not uaa_service:
        # If we are running LOCALLY (not on BTP), allow bypass
        # We detect local by checking if VCAP_SERVICES is missing
        if not os.getenv("VCAP_SERVICES"):
            print("WARNING: Running locally without XSUAA. Auth bypassed.")
            return {"user": "local-dev"}
            
        # If on BTP and service is missing -> CRASH (Safety first)
        raise HTTPException(status_code=500, detail="Server Error: XSUAA service 'dscp-ai-app' is not bound!")

    # 2. Validate Token
    try:
        token = credentials.credentials
        security_context = xssec.create_security_context(token, uaa_service.credentials)
        is_valid = security_context.validate()

        if not is_valid:
            raise HTTPException(status_code=401, detail="Invalid Authentication Token")

        return security_context

    except Exception as e:
        print(f"Auth Error: {e}")
        raise HTTPException(status_code=401, detail="Authentication Failed")