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
