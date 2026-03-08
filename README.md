# BSH Digital Supply Chain Planning - AI Projects



A FastAPI application with Jinja2 templating for DSCP AI APPS

## Installation

1. **Clone the repository**
```bash
cd c:\Users\dxdel\Extra Activities\THEAI\Ai Projects\DSCP_AI
```

2. **Create a virtual environment** 
```bash
python -m venv venv
venv\Scripts\activate
```

3. **Install dependencies**
```bash
pip install -r requirements.txt
```

## Usage

### Start the Development Server
```bash
python main.py
```

Or use Uvicorn directly:
```bash
uvicorn main:app --reload

USE_SAP_CONNECTIVITY=false python -m uvicorn app.main:app
```

### Access the Application
- Home: `http://localhost:8000/`
- Signavio BPMN Creator: `http://localhost:8000/signavio-bpmn`
- Health Check: `http://localhost:8000/health`

## XSUAA Role Provisioning (BTP)

If roles/templates do not appear in BTP, the XSUAA service was likely not created/updated from `xs-security.json`.

Use the helper script before or after deployment:

```powershell
./scripts/provision-xsuaa.ps1 -ServiceName dscp-ai-app -AppName dscp-ai -SecurityFile xs-security.json
```

What it does:
- Creates `xsuaa` service instance (plan `application`) if missing
- Updates existing service with `xs-security.json` if it already exists
- Waits for operation success
- Binds service to app and restages app

After this, in BTP Cockpit:
- Create Role Collections
- Add the role templates (`Viewer`, `Administrator`)
- Assign collections to users/groups

Note: Role templates/scopes are provisioned from `xs-security.json`; role collections and user assignment are managed in Cockpit/IAS.
