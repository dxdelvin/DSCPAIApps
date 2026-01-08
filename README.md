# BSH Digital Supply Chain Planning - AI Projects

A FastAPI application with Jinja2 templating for generating intelligent BPMN diagrams and other supply chain optimization tools.

## Project Structure

```
DSCP_AI/
├── main.py                          # FastAPI application entry point
├── requirements.txt                 # Python dependencies
├── templates/                       # Jinja2 HTML templates
│   ├── base.html                   # Base template with navbar and footer
│   ├── index.html                  # Home page
│   └── signavio_bpmn.html          # Signavio BPMN Creator page
└── static/                          # Static files (CSS, JS, images)
    ├── css/
    │   ├── common.css              # Common styles for all pages
    │   └── signavio_bpmn.css       # Signavio BPMN specific styles
    └── js/
        ├── common.js               # Common utilities (toast, DOM helpers)
        └── signavio_bpmn.js        # Signavio BPMN form logic
```

## Features

### 🏠 Home Page
- Welcome screen with available tools
- Product cards for different features
- Navigation to different modules

### 📊 Signavio BPMN Creator
An 8-step questionnaire-based BPMN generator:

1. **Basic Info** - Process name, owner, and description
2. **Events** - Start, end, and intermediate events
3. **Participants** - Actors and external systems involved
4. **Activities** - Main tasks and activities
5. **Decisions** - Decision points and gateways
6. **Data & Systems** - Input/output data and database requirements
7. **Rules** - Business rules and exception handling
8. **Review** - Summary review before generation

Features:
- Multi-step form with step indicator
- Form validation
- Data persistence between steps
- Summary review before generation
- Fake BPMN XML download (API integration placeholder)

### 🎨 Common Components

#### Toast Notification System
- Top-right notifications
- Four types: success, error, warning, info
- Auto-dismiss after configurable duration
- Manual close button

#### Common Utilities (common.js)
- Toast notification management
- DOM helpers
- API request wrapper
- Utility functions (email validation, date formatting, etc.)

#### Common Styles (common.css)
- Responsive navbar with sticky positioning
- Footer with copyright
- Button styles (primary, secondary, success, danger)
- Form element styling
- Toast notification styles
- Loading spinner
- Responsive design for mobile

## Installation

1. **Clone/Navigate to project directory**
```bash
cd c:\Users\dxdel\Extra Activities\THEAI\Ai Projects\DSCP_AI
```

2. **Create virtual environment** (recommended)
```bash
python -m venv venv
venv\Scripts\activate
```

3. **Install dependencies**
```bash
pip install -r requirements.txt
```

## Running the Application

### Development Server
```bash
python main.py
```

The application will start at `http://localhost:8000`

### Using Uvicorn directly
```bash
uvicorn main:app --reload
```

### Access the Application
- Home: `http://localhost:8000/`
- Signavio BPMN Creator: `http://localhost:8000/signavio-bpmn`
- Health Check: `http://localhost:8000/health`

## API Endpoints

### GET Endpoints
- `GET /` - Home page
- `GET /signavio-bpmn` - Signavio BPMN Creator page
- `GET /health` - Health check endpoint
- `GET /download-bpmn` - Download generated BPMN file

### POST Endpoints
- `POST /api/generate-bpmn` - Generate BPMN (currently fake response)

## JavaScript Utilities

### Toast Notifications
```javascript
// Show success notification
showToast('Operation successful!', 'success');

// Show error notification
showToast('An error occurred', 'error', Toast.DURATION.LONG);

// Using Toast class directly
Toast.show('Custom message', 'info', 3000);
```

### DOM Helpers
```javascript
// Select elements
DOM.select('#myId')
DOM.selectAll('.my-class')

// Manage classes
DOM.addClass(element, 'active')
DOM.removeClass(element, 'active')
DOM.toggleClass(element, 'active')
DOM.hasClass(element, 'active')

// Manipulate DOM
DOM.create('div', {class: 'my-class'}, 'Content')
DOM.empty(parentElement)
```

### Utility Functions
```javascript
// Validation
Utils.isEmpty(value)
Utils.isValidEmail(email)

// Date/Time
Utils.formatDate(new Date())
Utils.formatTime(new Date())

// Utilities
Utils.deepClone(object)
Utils.getQueryParam('paramName')
Utils.generateId()

// API
Utils.apiRequest('/api/endpoint', {method: 'POST', body: JSON.stringify(data)})
```

## CSS Customization

### Colors
Colors are defined as CSS variables in `common.css`:
```css
--primary-color: #ff6b35
--secondary-color: #6c757d
--success-color: #28a745
--danger-color: #dc3545
--warning-color: #ffc107
--info-color: #17a2b8
```

### Spacing
Standard spacing scale: 0.5rem, 1rem, 1.5rem, 2rem

### Responsive Breakpoints
- Mobile: < 480px
- Tablet: 480px - 768px
- Desktop: > 768px

## Future Enhancements

- [ ] Connect to actual BPMN generation API
- [ ] Database integration for saving processes
- [ ] User authentication and authorization
- [ ] Process history and versioning
- [ ] Additional product modules
- [ ] Advanced analytics dashboard
- [ ] Real-time collaboration features

## Technology Stack

- **Backend**: FastAPI (Python)
- **Templating**: Jinja2
- **Frontend**: HTML5, CSS3, Vanilla JavaScript
- **Server**: Uvicorn (ASGI)
- **Deployment**: Ready for Docker, cloud platforms

## Notes

- Currently, BPMN generation returns fake XML downloads for demonstration
- API endpoints are prepared for future backend integration
- All styling is responsive and mobile-friendly
- Common utilities can be reused across all product modules

## Contact

For issues or feature requests, please contact the development team.
