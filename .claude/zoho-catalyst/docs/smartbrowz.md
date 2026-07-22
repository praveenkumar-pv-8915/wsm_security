FILE_PURPOSE: Read when using Catalyst SmartBrowz for headless browser automation, PDF/screenshot generation, or web scraping via Browser Logic functions.
TRIGGER_KEYWORDS: SmartBrowz, headless browser, Browser Logic, Puppeteer, Playwright, Selenium, PDF screenshot, Dataverse, web scraping, headless Chrome, browser automation
SOURCE_DOC: help-docs/smartbrowz.md

TECHNICAL_CONSTRAINTS:
- Remote browser: Chrome only (no other browsers currently)
- Browser Logic function type: Java and Node.js only — Python is NOT supported for Browser Logic
- 5 components: Headless, Browser Logic, PDF & Screenshot, Templates, Dataverse
- Headless: connects to remote browser via Puppeteer, Playwright, or Selenium; API KEY auto-generated in console for authentication
- Browser Logic: a specialized Serverless function type; initialized via CLI; deployed like other functions; logs appear in Catalyst Logs (access + application logs)
- PDF & Screenshot: generate PDFs or screenshots from HTML, URL, or Template inputs; available via SDK (Java, Node.js, Python) and API
- Templates: design reusable templates with front-end scripting languages; used to generate PDFs/screenshots with dynamic content
- Dataverse: web scraping via Catalyst APIs — complex data extraction operations
- All browser actions are developer's responsibility; use only on permitted domains

REQUIRED_PARAMETERS:
- Headless: API KEY (from console) + endpoint URL (from console); automation library (Puppeteer/Playwright/Selenium) configured to connect to Catalyst remote browser endpoint
- Browser Logic function: create via `catalyst functions:create` → select Browser Logic type → Java or Node.js
- PDF & Screenshot SDK (Node.js):
  ```js
  const smartBrowz = app.smartBrowz();
  const pdf = await smartBrowz.generatePDF({ url: 'https://example.com' });
  ```
- Inputs for PDF/Screenshot: URL, raw HTML string, or Template name with dynamic values

UI_ONLY_ACTIONS:
- Get Headless endpoint and API KEY: Console → SmartBrowz → Headless → copy endpoint + API KEY
- Configure browser memory/version: Console → SmartBrowz → Headless → Settings → select memory + browser version
- Generate PDF/Screenshot from console: Console → SmartBrowz → PDF & Screenshot → enter URL/HTML/Template → select output type → Generate
- Create Template: Console → SmartBrowz → Templates → Create Template → code template in editor → Save
- View Dataverse: Console → SmartBrowz → Dataverse → configure scraping → Execute
- Note: Headless browser connectivity, PDF/Screenshot, and Dataverse operations also available via SDK and API; Browser Logic deployed via CLI

CRITICAL_FAILURE_MODES:
- Using Python for Browser Logic function: Python is not supported; only Java and Node.js — function creation will fail or produce incorrect scaffold
- Browser other than Chrome: only Chrome is available; do not attempt to configure Puppeteer/Playwright for Firefox or Safari in the Catalyst headless environment
- API KEY missing in headless connection request: authentication fails; always include the API KEY from the console in headless endpoint calls
- Scraping/automation on domains that block it: operations may fail or be blocked at the target domain level; Catalyst does not bypass domain-level restrictions — ensure permission to scrape
- Browser Logic function not deployed before calling: like any function, must be deployed to console before it can be invoked
