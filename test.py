import os
import requests
import json
from dotenv import load_dotenv

# 1. Load environment variables
load_dotenv()

# Configuration from your provided .env (Defaults added just in case)
BASE_URL = os.getenv("BRAIN_API_BASE_URL", "https://ews-emea.api.bosch.com:443/it/application/dia-brain/q/v1/api")
TENANT_ID = os.getenv("BRAIN_TENANT_ID", "0ae51e19-07c8-4e4b-bb6d-648ee58410f4")
CLIENT_ID = os.getenv("BRAIN_CLIENT_ID", "7af3e866-fe90-4c7e-ba7b-a767678e6200")
CLIENT_SECRET = os.getenv("BRAIN_CLIENT_SECRET") # Must be in .env
BRAIN_ID_TO_TEST = os.getenv("SIGNAVIO_BRAIN_ID", "uyO4orNRPj9p")

# Microsoft Login URL (Standard for Azure AD)
TOKEN_URL = f"https://login.microsoftonline.com/{TENANT_ID}/oauth2/v2.0/token"

PROXIES = {
    "http": os.getenv("HTTP_PROXY"),
    "https": os.getenv("HTTPS_PROXY")
}

def get_access_token():
    """
    Fetches the OAuth2 Bearer token using Client Credentials flow.
    Ref: PDF Page 9
    """
    print(f"[-] Authenticating with Azure AD...")
    
    headers = {
        'Content-Type': 'application/x-www-form-urlencoded'
    }
    
    payload = {
        'client_id': CLIENT_ID,
        'client_secret': CLIENT_SECRET,
        'scope': 'api://dia-brain/.default',
        'grant_type': 'client_credentials'
    }

    try:
        response = requests.post(TOKEN_URL, data=payload, headers=headers)
        response.raise_for_status()
        
        token_data = response.json()
        print(f"[+] Authentication successful! Token received.")
        return token_data['access_token']
        
    except requests.exceptions.RequestException as e:
        print(f"[!] Authentication Failed: {e}")
        if response is not None:
            print(f"Response Body: {response.text}")
        exit(1)

def test_brain_api(access_token):
    """
    Calls the Brain API endpoint.
    Ref: PDF Page 11 (User-Agent requirement) & Swagger (sharepoint-sites endpoint)
    """
    print(f"[-] Testing Brain API Connectivity for Brain ID: {BRAIN_ID_TO_TEST}...")

    headers = {
        'Authorization': f"Bearer {access_token}",
        'User-Agent': 'PythonTestScript/1.0', 
        'Accept': 'application/json'
    }

    endpoint = f"{BASE_URL}/knowledge-bases"
    
    params = {
        'knowledgeBaseId': BRAIN_ID_TO_TEST
    }

    try:
        # Check if we are loading proxies correctly
        if PROXIES['https']:
            print(f"[-] Using Proxy: {PROXIES['https']}")
        else:
            print("[!] Warning: No Proxy defined in .env (HTTPS_PROXY). Connection might timeout.")

        # PASS PROXIES HERE vvv
        response = requests.get(endpoint, headers=headers, params=params, proxies=PROXIES)
        
        print(f"[-] Request URL: {response.url}")
        print(f"[-] Status Code: {response.status_code}")

        if response.status_code == 200:
            print("[+] SUCCESS: Connection established and data retrieved.")
            print(json.dumps(response.json(), indent=2))
        elif response.status_code == 401:
            print("[!] FAILED: Unauthorized. Check if your App ID is whitelisted for this Brain.")
        elif response.status_code == 403:
             print("[!] FAILED: Forbidden. Ensure App ID is mapped to your User in Brain UI (PDF Page 7).")
        else:
            print(f"[!] FAILED: Unexpected Error.")
            print(response.text)

    except requests.exceptions.SSLError as ssl_err:
        print(f"[!] SSL Error: {ssl_err}")
        print("    -> You might need to add 'verify=False' to requests.get() if Zscaler is intercepting SSL (NOT SECURE).")
        # To bypass SSL verify temporarily for testing:
        # response = requests.get(endpoint, headers=headers, params=params, proxies=PROXIES, verify=False)
        
    except requests.exceptions.RequestException as e:
        print(f"[!] Connection Error: {e}")

if __name__ == "__main__":
    if not CLIENT_SECRET:
        print("[!] Error: BRAIN_CLIENT_SECRET is missing from .env file or environment.")
        exit(1)
        
    token = get_access_token()
    test_brain_api(token)