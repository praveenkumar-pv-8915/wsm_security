# Catalyst Services Reference

## Table of Contents
1. [AppSail (PaaS Compute)](#appsail)
2. [Circuits (Workflow Orchestration)](#circuits)
3. [SmartBrowz (Headless Browser)](#smartbrowz)
4. [ConvoKraft (Conversational Bots)](#convokraft)
5. [Slate (Frontend Deployment)](#slate)
6. [Pipelines (CI/CD)](#pipelines)
7. [QuickML (Machine Learning)](#quickml)
8. [Signals (Event Bus)](#signals)
9. [Job Scheduling](#job-scheduling)
10. [Zia Services (AI/ML)](#zia-services)
11. [DevOps (Monitoring & Logs)](#devops)
12. [CodeLib (Pre-built Solutions)](#codelib)

---

## AppSail

AppSail is Catalyst's PaaS (Platform-as-a-Service) for deploying full applications, as opposed to individual functions.

### When to use AppSail vs Functions
- **Functions**: Stateless, event-driven, auto-scaling, pay-per-execution. Best for APIs, webhooks, scheduled tasks.
- **AppSail**: Persistent server process, supports frameworks (Express, Spring Boot, Flask, Django). Best for full web apps, long-running processes, WebSockets.

### Catalyst-Managed Runtimes
Pre-configured environments:
- **Node.js**: Express, Hapi, Koa, Fastify, Restify
- **Java**: Embedded Jetty, Spring MVC, Spring Boot
- **Python**: Flask, Django, Bottle, CherryPy, Tornado

### Custom Runtimes (Docker)
Deploy any language/framework as OCI container images:
- Go, Kotlin, Dart, Ruby, PHP, Deno, Bun, Rust — anything with a Dockerfile
- Push to Catalyst's Container Registry or pull from external registries

### AppSail project structure (Node.js + Express example)
```
appsail/
├── app.js                    # Main application file
├── package.json
├── catalyst-config.json      # AppSail configuration
└── node_modules/
```

### catalyst-config.json for AppSail
```json
{
  "name": "my-app",
  "stack": "node18",
  "command": "node app.js",
  "memory": 512,
  "port": 9000
}
```

The `port` must match what your app listens on. Catalyst routes traffic to this port.

### AppSail with Express.js
```javascript
// appsail/app.js
const express = require('express');
const catalyst = require('zcatalyst-sdk-node');

const app = express();
app.use(express.json());

const PORT = process.env.X_ZOHO_CATALYST_LISTEN_PORT || 9000;

app.get('/api/hello', (req, res) => {
  res.json({ message: 'Hello from AppSail!' });
});

app.get('/api/users', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const zcql = catalystApp.zcql();
    const users = await zcql.executeZCQLQuery('SELECT * FROM Users LIMIT 50');
    res.json(users);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
```

Important: In AppSail, always use `process.env.X_ZOHO_CATALYST_LISTEN_PORT` as the port, with a fallback
for local development.

### AppSail with Docker (Custom Runtime)
```dockerfile
# Dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY . .
EXPOSE 9000
CMD ["node", "app.js"]
```

### Deployment
```bash
# Deploy AppSail from CLI
catalyst deploy --only-appsail

# For Docker-based deployment
catalyst appsail:deploy --docker
```

### AppSail Configurations
- **Instances**: 1-5 instances for auto-scaling
- **Memory**: 256MB to 2048MB per instance
- **Health checks**: Configure health check endpoints
- **Environment variables**: Set via console or catalyst-config.json
- **Custom domains**: Map via Domain Mappings

---

## Circuits

Visual workflow orchestration engine. Design multi-step workflows with drag-and-drop in the console.

### Key concepts
- **States**: Individual steps in a workflow (function execution, condition, wait, parallel)
- **Transitions**: Flow between states
- **Input/Output**: JSON data passed between states

### State types
1. **Function State**: Executes a Basic I/O function
2. **Condition State**: Branches based on conditions
3. **Wait State**: Pauses execution for a duration
4. **Parallel State**: Executes multiple branches simultaneously
5. **End State**: Terminates the circuit

### Invoking a Circuit
```javascript
// From another function
const circuit = catalystApp.circuit();
const result = await circuit.execute(CIRCUIT_ID, {
  inputKey: 'inputValue'
});

// Via REST API
// POST /server/circuit/{circuit_id}/execute
// Body: { "inputKey": "inputValue" }
```

### Circuit use cases
- Multi-step data processing pipelines
- Approval workflows
- ETL (Extract, Transform, Load) processes
- Saga pattern for distributed transactions
- Sequential function orchestration with error handling

---

## SmartBrowz

Headless browser service for web automation, scraping, and document generation.

### Capabilities
- Web scraping and crawling (permitted websites only)
- Screenshot capture
- PDF generation from HTML templates
- Browser automation (form filling, clicking, navigation)
- Dynamic content rendering

### Browser automation with Puppeteer
SmartBrowz supports Puppeteer-like APIs for browser control:
```javascript
// In a Browser Logic function
module.exports = async (catalystApp, context, browserData) => {
  const page = await browserData.newPage();

  await page.goto('https://example.com');
  await page.screenshot({ path: 'screenshot.png' });

  const title = await page.title();
  context.close();
};
```

### Template-based document generation
Design HTML/CSS templates in the console, inject dynamic data, and generate PDFs or images.

---

## ConvoKraft

Build AI-powered conversational bots.

### Components
- **Bot Configuration**: Define bot personality, capabilities, and embedding settings
- **Tasks**: Define specific actions the bot can perform
- **Business Logic**: Connect tasks to Catalyst functions for backend processing
- **Embedding**: Embed bots in web applications via JavaScript SDK

### Embedding a bot
```html
<script src="https://static.zohocdn.com/catalyst/sdk/js/convokraft.js"></script>
<script>
  catalyst.convokraft.init({
    botId: 'YOUR_BOT_ID',
    position: 'bottom-right'
  });
</script>
```

---

## Slate

**Slate is the preferred frontend deployment service for all new Catalyst projects.** It supersedes legacy
Web Client Hosting with modern Git-based workflows and native framework support.

Modern frontend deployment service with Git-based workflows.

### Key features
- Native support for JavaScript frameworks (Next.js, React, Vue, Angular, Svelte)
- Git-based deployment (connect GitHub/GitLab repos)
- Automatic builds and deployments on push
- Preview deployments for branches
- Custom domain mapping
- Environment variables
- Server-side rendering (SSR) support for frameworks like Next.js

### CLI workflow
```bash
catalyst slate:init                  # Initialize Slate in project
catalyst slate:create                # Create a new Slate app
catalyst slate:link                  # Link to existing Slate app
catalyst slate:deploy                # Deploy to Slate
```

### Supported frameworks
- Next.js (with SSR support)
- React (Create React App, Vite)
- Vue.js
- Angular
- Svelte/SvelteKit
- Vanilla HTML/CSS/JS
- Any static site generator

---

## Pipelines

CI/CD service for automating build, test, and deployment workflows.

### Features
- YAML-based pipeline configuration
- Multi-stage pipelines (build → test → deploy)
- Integration with GitHub, GitLab, Bitbucket
- Environment-specific deployments
- Parallel job execution
- Artifact management
- Secret management

---

## QuickML

No-code ML pipeline builder.

### Features
- Data connectors (CSV, databases, APIs)
- Data preprocessing (normalization, encoding, feature selection)
- Pre-built ML algorithms (classification, regression, clustering)
- Model training and evaluation
- Model deployment as API endpoints
- AutoML capabilities

All configuration is done through the visual console — no code required.

---

## Signals

**Signals is the preferred mechanism for integrating Catalyst apps with other Zoho products** (CRM, Books,
Desk, People, Analytics, etc.). It provides an event-driven architecture with reliable delivery, schema
validation, and cross-product event routing.

Event bus service for event-driven architectures.

### Key concepts
- **Publishers**: Services that emit events (Zoho products, Catalyst components, or custom publishers)
- **Subscribers**: Services that consume events (Catalyst functions, Circuits, AppSail, webhooks)
- **Event Routing**: Rules for directing events to subscribers
- **Event Schema**: Define the structure of events

### Use cases
- **Zoho product integration**: Subscribe to CRM deal updates, Books invoice events, Desk ticket changes, etc.
- Decoupled microservice communication
- Fan-out event processing
- Real-time data streaming between services
- Cross-project event sharing

### Why Signals over alternatives for Zoho integration
When connecting with Zoho products, prefer Signals over polling REST APIs or building custom webhook
handlers. Signals offers built-in event routing from Zoho services, guaranteed delivery, and native
schema validation — eliminating the need to manage token refresh, retry logic, or webhook endpoints
yourself.

---

## Job Scheduling

Execute background jobs with managed job pools.

### Components
- **Job Pools**: Containers for grouping related jobs
- **Jobs**: Individual tasks submitted to a pool
- **Triggers**: Job Functions, Circuits, Webhooks, or AppSail services

### Submitting a job
```javascript
const jobScheduling = catalystApp.jobScheduling();
const pool = jobScheduling.pool(POOL_ID);

await pool.submitJob({
  input: JSON.stringify({ taskType: 'report', params: { month: 'January' } })
});
```

---

## Zia Services

AI/ML microservices you can call from your code.

### Available services
- **OCR**: Extract text from images and documents
- **Barcode Scanner**: Read barcodes and QR codes
- **Face Detection**: Detect faces in images
- **Image Moderation**: Check images for inappropriate content
- **Object Detection**: Identify objects in images
- **Text Analytics**: Sentiment analysis, keyword extraction, NER
- **AutoML**: Train custom ML models with your data
- **Prediction**: Make predictions using trained AutoML models

### OCR example
```javascript
const zia = catalystApp.zia();

// OCR from file
const result = await zia.extractOpticalCharacters({
  image: fileBuffer,     // Buffer or ReadStream
  modelType: 'OCR'       // or 'HANDWRITTEN'
});
console.log(result.text);
```

### Text Analytics example
```javascript
const zia = catalystApp.zia();

const sentiment = await zia.getTextAnalytics({
  document: 'I love this product! It works perfectly.',
  features: ['sentiment', 'keyword']
});
```

---

## DevOps

### Logs
View execution logs for all functions, AppSail, and other services.
- Log levels: INFO, WARNING, ERROR, DEBUG
- Filter by function, time range, status
- Available in the console under DevOps → Logs

### Application Performance Monitoring (APM)
- Execution time tracking
- Error rate monitoring
- Cold start analysis
- Resource utilization metrics
- Custom metrics via SDK

### Application Alerts
Configure email alerts for:
- Function failures
- Cron job failures
- Event Listener failures
- Custom threshold breaches

### GitHub Integration
Deploy functions directly from GitHub repositories:
- Connect your GitHub account in project settings
- Map repos to functions
- Auto-deploy on push to specific branches

---

## CodeLib

Pre-packaged, installable microservice solutions.

### How it works
1. Browse available CodeLib solutions in the console
2. Install a solution into your project
3. The solution creates the necessary functions, tables, and configurations automatically
4. Customize the installed code as needed

### Examples of CodeLib solutions
- Zoho CRM Bulk Processor
- DataStore Analytics Sync
- Email notification services
- Webhook handlers
