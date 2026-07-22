# Industry Equivalents: Catalyst Services vs Established Platforms

This reference maps every Catalyst service/component to its closest equivalent(s) on AWS, GCP, Azure,
and other well-known platforms. Use this mapping to:
- Help users who come from AWS/GCP/Azure understand Catalyst concepts instantly
- Translate user requests phrased in terms of other platforms ("I need something like S3")
- Make architecture recommendations using familiar mental models

> **Important context (April 2026):** Event Listeners, File Store, and Cron are deprecated
> (announced August 2025, EOL April 30, 2026). Guide users to their replacements: Signals
> (for Event Listeners), Stratus (for File Store), and Job Scheduling (for Cron).

---

## Table of Contents
1. [Compute](#compute)
2. [Data & Storage](#data--storage)
3. [Frontend & Hosting](#frontend--hosting)
4. [Workflow & Orchestration](#workflow--orchestration)
5. [AI & Machine Learning](#ai--machine-learning)
6. [Integration & Events](#integration--events)
7. [DevOps & CI/CD](#devops--cicd)
8. [Security & Identity](#security--identity)
9. [Communication](#communication)
10. [Quick Lookup Table](#quick-lookup-table)

---

## Compute

### Functions (Basic I/O, Advanced I/O, Event, Cron, Integration, Job, Browser Logic)
| Equivalent | Platform |
|---|---|
| AWS Lambda | AWS |
| Google Cloud Functions | GCP |
| Azure Functions | Azure |
| Cloudflare Workers | Cloudflare |
| Netlify Functions | Netlify |
| Vercel Serverless Functions | Vercel |
| Supabase Edge Functions | Supabase |

**Key differences from Lambda/Cloud Functions:**
- Catalyst bundles 7 specialized function types with distinct handler signatures, whereas AWS/GCP
  use a single function model with event sources configured externally.
- Catalyst auto-injects the SDK (`catalystApp`) into the handler — no manual SDK init needed in
  functions (unlike Lambda where you `require('aws-sdk')` yourself).
- Security Rules (no_auth/user_auth/admin_auth) are built into the function config — no separate
  IAM/API Gateway auth layer needed as in AWS.
- Cold starts exist on all platforms; Catalyst functions default to 128MB memory (max 1024MB),
  comparable to Lambda's range.

**When a user says → they mean:**
- "I need a Lambda function" → Catalyst Advanced I/O Function (most flexible, HTTP-based)
- "I need a Cloud Function triggered by events" → Catalyst Event Function + Signals
- "I need a scheduled Lambda" → Catalyst Cron Function (deprecated) → use Job Scheduling instead
- "I need a background worker" → Catalyst Job Function

### AppSail (PaaS Compute)
| Equivalent | Platform |
|---|---|
| AWS App Runner / Elastic Beanstalk | AWS |
| Google Cloud Run | GCP |
| Azure App Service | Azure |
| Heroku | Heroku |
| Railway | Railway |
| Render | Render |
| Fly.io | Fly.io |

**Key differences:**
- AppSail supports both managed runtimes (Node.js, Java, Python) AND custom Docker containers,
  similar to Cloud Run's model.
- Auto-scaling is 1–5 instances (more limited than Cloud Run's 0–1000 or App Runner's scale).
- SDK initialization is manual in AppSail (`catalyst.initialize(req)`) — same mental model as
  initializing the AWS SDK in an ECS/App Runner container.
- Uses `process.env.X_ZOHO_CATALYST_LISTEN_PORT` instead of `PORT` (GCP) or `8080` default.

**When a user says → they mean:**
- "I want to deploy an Express app like on Heroku" → AppSail with managed Node.js runtime
- "I need Cloud Run-style containers" → AppSail with Custom Runtime (Docker)
- "I need a persistent server, not serverless" → AppSail

---

## Data & Storage

### Data Store (Relational Database)
| Equivalent | Platform |
|---|---|
| Amazon RDS / DynamoDB (structured) | AWS |
| Google Cloud SQL / Cloud Spanner | GCP |
| Azure SQL Database | Azure |
| PlanetScale | PlanetScale |
| Supabase Postgres | Supabase |
| Neon | Neon |
| Firebase Realtime Database (loosely) | Firebase |

**Key differences:**
- Data Store is a managed relational database with a web console for table management — closer
  to Supabase's table editor than raw RDS.
- Uses ZCQL (not standard SQL) — case-sensitive table/column names, no cross-type JOINs,
  max 200 rows per query.
- System columns (ROWID, CREATORID, CREATEDTIME, MODIFIEDTIME) are auto-managed — similar to
  Supabase's auto-generated `id`, `created_at` columns.
- No direct SQL access or connection strings — all access via SDK or ZCQL.

**When a user says → they mean:**
- "I need a Postgres database" → Data Store (but note ZCQL differences)
- "I need Supabase tables" → Data Store with ZCQL
- "I need a relational DB with an admin UI" → Data Store (web console)

### Stratus (Object Storage) — PREFERRED for new projects
| Equivalent | Platform |
|---|---|
| Amazon S3 | AWS |
| Google Cloud Storage | GCP |
| Azure Blob Storage | Azure |
| Cloudflare R2 | Cloudflare |
| MinIO | Self-hosted |
| Backblaze B2 | Backblaze |
| DigitalOcean Spaces | DigitalOcean |

**Key differences:**
- S3-compatible API patterns (buckets, keys, prefixes) — users familiar with S3 will feel at home.
- No per-file size constraints at the default tier (unlike File Store's 100MB limit).
- Bucket-based organization with prefix-based listing, same as S3.

**When a user says → they mean:**
- "I need S3" → Stratus
- "I need object/blob storage" → Stratus
- "I need to store user uploads, media, backups" → Stratus
- "I need R2 or Spaces" → Stratus

### File Store (Simple File Storage) — DEPRECATED (EOL April 30, 2026)
| Equivalent | Platform |
|---|---|
| A simplified S3 with folder semantics | AWS (conceptual) |
| Firebase Storage (older API) | Firebase |

**Status:** Deprecated. Migrate to Stratus. Only use for legacy projects.

### NoSQL (Document Database)
| Equivalent | Platform |
|---|---|
| Amazon DynamoDB | AWS |
| Google Cloud Firestore | GCP |
| Azure Cosmos DB | Azure |
| MongoDB Atlas | MongoDB |
| Firebase Firestore | Firebase |
| Supabase (loosely, with JSONB) | Supabase |

**Key differences:**
- Collection-based document store — closest mental model is Firestore or MongoDB.
- Supports nested objects, arrays, and query-by-field.
- No secondary indexes or aggregation pipelines (simpler than DynamoDB/Firestore).

**When a user says → they mean:**
- "I need Firestore / MongoDB" → NoSQL
- "I need a document database for flexible schemas" → NoSQL
- "I need key-value with nested data" → NoSQL

### Cache (In-Memory Cache)
| Equivalent | Platform |
|---|---|
| Amazon ElastiCache (Redis/Memcached) | AWS |
| Google Cloud Memorystore | GCP |
| Azure Cache for Redis | Azure |
| Upstash Redis | Upstash |
| Redis Cloud | Redis Labs |
| Vercel KV | Vercel |

**Key differences:**
- Segment-based organization (not key namespaces like Redis).
- String values only — must serialize/deserialize JSON yourself.
- Max TTL of 48 hours (172800 seconds) — shorter than Redis's unlimited TTL.
- Max value size 5MB — comparable to Redis's 512MB but practically sufficient.

**When a user says → they mean:**
- "I need Redis" → Cache (with segment-based organization)
- "I need a caching layer" → Cache
- "I need session storage" → Cache (but note 48hr TTL limit)

### Search (Full-Text Search)
| Equivalent | Platform |
|---|---|
| Amazon OpenSearch / CloudSearch | AWS |
| Elasticsearch / Elastic Cloud | Elastic |
| Algolia | Algolia |
| Typesense | Typesense |
| Meilisearch | Meilisearch |

**Key differences:**
- Searches across Data Store tables only — not a general-purpose search engine.
- Must enable search per-column in the console (only Text/Text Area columns).
- Simpler than Elasticsearch but tightly integrated with Data Store.

**When a user says → they mean:**
- "I need Elasticsearch" → Search (if searching Data Store) or suggest external service for complex needs
- "I need full-text search on my data" → Search
- "I need Algolia-like search" → Search (for basic needs) or external service (for advanced features)

---

## Frontend & Hosting

### Slate (Frontend Deployment) — PREFERRED for new projects
| Equivalent | Platform |
|---|---|
| Vercel | Vercel |
| Netlify | Netlify |
| Cloudflare Pages | Cloudflare |
| AWS Amplify Hosting | AWS |
| Firebase Hosting | Firebase |
| GitHub Pages (static only) | GitHub |
| Render Static Sites | Render |

**Key differences:**
- Git-based deployments (GitHub, GitLab, Bitbucket) — same workflow as Vercel/Netlify.
- Preview deployments for branches — like Vercel's preview URLs.
- Supports SSR (Next.js) — like Vercel, unlike basic static hosts.
- Native framework support: Next.js, React, Vue, Angular, Svelte, SolidJS, Preact, Astro, Nuxt, Vite.
- Key advantage: integrated with all Catalyst backend services (Data Store, Functions, Auth) —
  no need to stitch together separate services as with Vercel + external DB + external auth.
- Multiple frontend apps per project (unlike some platforms that are 1:1).

**When a user says → they mean:**
- "I want to deploy like Vercel/Netlify" → Slate
- "I need frontend hosting with SSR" → Slate
- "I need preview deployments" → Slate
- "I need a CDN for my React/Next.js app" → Slate

### Web Client Hosting — LEGACY
| Equivalent | Platform |
|---|---|
| Basic static hosting (pre-Netlify era) | — |
| AWS S3 static website hosting | AWS |

**Status:** Legacy. Use Slate for all new projects.

### Domain Mappings
| Equivalent | Platform |
|---|---|
| Route 53 + CloudFront custom domains | AWS |
| Cloud Domains + Load Balancer | GCP |
| Vercel/Netlify custom domains | Vercel/Netlify |

Free SSL certificates auto-provisioned (like Let's Encrypt on Vercel/Netlify).

---

## Workflow & Orchestration

### Circuits (Visual Workflow Orchestration)
| Equivalent | Platform |
|---|---|
| AWS Step Functions | AWS |
| Google Cloud Workflows | GCP |
| Azure Logic Apps / Durable Functions | Azure |
| Temporal | Temporal |
| Inngest | Inngest |
| n8n / Make (Integromat) | No-code tools |

**Key differences:**
- Visual drag-and-drop workflow builder in the console — closer to Step Functions Visual
  Workflow Studio or Azure Logic Apps.
- State types: Function, Condition, Wait, Parallel, End — maps closely to Step Functions'
  Task, Choice, Wait, Parallel, End states.
- Invokable via SDK (`catalystApp.circuit().execute()`) or REST API.

**When a user says → they mean:**
- "I need Step Functions" → Circuits
- "I need workflow orchestration" → Circuits
- "I need to chain functions together" → Circuits
- "I need an approval workflow" → Circuits
- "I need a saga pattern" → Circuits

### Job Scheduling (Background Jobs)
| Equivalent | Platform |
|---|---|
| AWS SQS + Lambda / AWS Batch | AWS |
| Google Cloud Tasks | GCP |
| Azure Queue Storage + Functions | Azure |
| BullMQ / Celery (self-hosted) | Self-hosted |
| Inngest | Inngest |
| Quirrel | Quirrel |

**Key differences:**
- Pool-based job management (submit jobs to pools) — similar to AWS Batch job queues.
- Triggers Job Functions, Circuits, Webhooks, or AppSail services.
- Replaces deprecated Cron for scheduled tasks.

**When a user says → they mean:**
- "I need a job queue" → Job Scheduling
- "I need background processing" → Job Scheduling + Job Functions
- "I need SQS + Lambda" → Job Scheduling + Job Functions
- "I need scheduled/cron jobs" → Job Scheduling (not deprecated Cron)

---

## AI & Machine Learning

### Zia Services (AI/ML Microservices)
| Equivalent | Platform |
|---|---|
| Amazon Rekognition (vision) | AWS |
| Amazon Textract (OCR) | AWS |
| Amazon Comprehend (NLP) | AWS |
| Google Cloud Vision API | GCP |
| Google Cloud Natural Language API | GCP |
| Azure Cognitive Services | Azure |
| Clarifai | Clarifai |

**Available Zia services and their equivalents:**
- **OCR** → Amazon Textract, Google Cloud Vision OCR, Azure Computer Vision OCR
- **Barcode Scanner** → Google ML Kit Barcode, AWS (custom Lambda)
- **Face Detection** → Amazon Rekognition, Google Cloud Vision Face Detection, Azure Face API
- **Image Moderation** → Amazon Rekognition Content Moderation, Google Cloud Vision SafeSearch
- **Object Detection** → Amazon Rekognition Labels, Google Cloud Vision Object Localization
- **Text Analytics** → Amazon Comprehend, Google Cloud Natural Language, Azure Text Analytics
- **AutoML** → Amazon SageMaker Autopilot, Google Cloud AutoML, Azure Automated ML

**When a user says → they mean:**
- "I need Rekognition/Vision API" → Zia Services (OCR, Face Detection, Object Detection)
- "I need Comprehend/NLP" → Zia Services Text Analytics
- "I need content moderation" → Zia Services Image Moderation

### QuickML (No-Code ML Platform)
| Equivalent | Platform |
|---|---|
| Amazon SageMaker Canvas | AWS |
| Google Cloud AutoML | GCP |
| Azure Machine Learning Designer | Azure |
| DataRobot | DataRobot |
| H2O.ai | H2O |
| Obviously AI | Obviously AI |
| CreateML (Apple) | Apple |

**Key differences:**
- Fully no-code, visual pipeline builder — closest to SageMaker Canvas or Azure ML Designer.
- Supports LLM serving (Qwen 2.5 models) with chat interface and OAuth-based integration.
- Data connectors, preprocessing, and model deployment as API endpoints — all via console.
- Custom code operations now supported within model training pipelines.

**When a user says → they mean:**
- "I need SageMaker/AutoML" → QuickML (for no-code ML)
- "I need to train a model without code" → QuickML
- "I need to deploy an ML model as an API" → QuickML
- "I need to serve LLMs" → QuickML LLM serving

### ConvoKraft (Conversational AI Bots)
| Equivalent | Platform |
|---|---|
| Amazon Lex | AWS |
| Google Dialogflow | GCP |
| Azure Bot Service | Azure |
| Botpress | Botpress |
| Rasa | Rasa |
| Intercom Fin | Intercom |
| Drift | Drift |

**Key differences:**
- Visual bot builder with task-based architecture.
- Backend tasks connect to Catalyst Functions for processing.
- Embeddable via JavaScript SDK — like Intercom/Drift widgets.

**When a user says → they mean:**
- "I need Dialogflow/Lex" → ConvoKraft
- "I need a chatbot" → ConvoKraft
- "I need an AI assistant on my website" → ConvoKraft

---

## Integration & Events

### Signals (Event Bus) — PREFERRED for Zoho integration
| Equivalent | Platform |
|---|---|
| Amazon EventBridge | AWS |
| Google Cloud Pub/Sub | GCP |
| Azure Event Grid | Azure |
| Kafka (self-hosted/managed) | Confluent |
| RabbitMQ | RabbitMQ |
| NATS | NATS |

**Key differences:**
- Native integration with Zoho products (CRM, Books, Desk, People, Analytics) — no equivalent
  in AWS/GCP for Zoho-specific events.
- Supports publishers, subscribers, event routing, and schema validation.
- Replaces deprecated Event Listeners for event-driven architectures.

**When a user says → they mean:**
- "I need EventBridge/Pub/Sub" → Signals
- "I need event-driven architecture" → Signals
- "I need to react to CRM/Zoho changes" → Signals
- "I need a message bus" → Signals

### Connections (OAuth Token Manager)
| Equivalent | Platform |
|---|---|
| AWS Secrets Manager (for tokens) | AWS |
| Google Secret Manager | GCP |
| Azure Key Vault | Azure |
| Auth0 Machine-to-Machine | Auth0 |

**Key differences:**
- Not just a secret store — actively manages OAuth2 token lifecycle (refresh, rotation).
- Pre-built connectors for Zoho services.
- Access tokens via `connector.getAccessToken()` — simpler than manual OAuth flows.

**When a user says → they mean:**
- "I need to connect to third-party APIs with OAuth" → Connections
- "I need token management" → Connections
- "I need Secrets Manager for API tokens" → Connections

### Event Listeners — DEPRECATED (EOL April 30, 2026)
Replaced by **Signals**. Previously triggered Event Functions on Data Store/File Store changes.

### Cron — DEPRECATED (EOL April 30, 2026)
Replaced by **Job Scheduling**. Use Job Scheduling for all scheduled/periodic tasks.

---

## DevOps & CI/CD

### Pipelines (CI/CD)
| Equivalent | Platform |
|---|---|
| AWS CodePipeline + CodeBuild | AWS |
| Google Cloud Build | GCP |
| Azure Pipelines | Azure |
| GitHub Actions | GitHub |
| GitLab CI/CD | GitLab |
| CircleCI | CircleCI |
| Jenkins | Jenkins |

**Key differences:**
- YAML-based pipeline configuration — similar to GitHub Actions or GitLab CI.
- Multi-stage pipelines, parallel jobs, artifact management.
- Integrated with GitHub, GitLab, Bitbucket.
- Also powers Slate's internal build-to-deploy process.

**When a user says → they mean:**
- "I need GitHub Actions/CI/CD" → Pipelines
- "I need automated deployment" → Pipelines (or Slate's built-in Git deploy)

### SmartBrowz (Headless Browser)
| Equivalent | Platform |
|---|---|
| AWS Lambda + Puppeteer layer | AWS |
| Browserless | Browserless |
| Playwright (self-hosted) | Microsoft |
| Apify | Apify |
| ScrapingBee | ScrapingBee |
| Puppeteer Cloud | Various |

**Key differences:**
- Managed headless browser service — no need to package Puppeteer/Chromium in a Lambda layer.
- Supports web scraping, screenshot capture, PDF generation, browser automation.
- Uses Browser Logic Functions with Puppeteer-like API.
- Template-based document generation (HTML/CSS → PDF) via the console.

**When a user says → they mean:**
- "I need Puppeteer in the cloud" → SmartBrowz
- "I need web scraping" → SmartBrowz
- "I need to generate PDFs from HTML" → SmartBrowz
- "I need headless browser automation" → SmartBrowz

### DevOps (Monitoring & Logs)
| Equivalent | Platform |
|---|---|
| Amazon CloudWatch | AWS |
| Google Cloud Logging + Monitoring | GCP |
| Azure Monitor | Azure |
| Datadog | Datadog |
| New Relic | New Relic |

**Includes:** Logs, APM (execution time, error rates, cold starts), and Application Alerts.

---

## Security & Identity

### Authentication & User Management
| Equivalent | Platform |
|---|---|
| Amazon Cognito | AWS |
| Firebase Authentication | Firebase |
| Auth0 | Auth0 |
| Clerk | Clerk |
| Supabase Auth | Supabase |
| Azure AD B2C | Azure |

**Key differences:**
- Built-in user management with sign-up, login, password reset.
- Supports Catalyst built-in auth, Zoho accounts, and custom SSO.
- Web SDK provides client-side auth flow (`catalyst.auth.login()`) — like Firebase Auth SDK.
- Security Rules on functions (no_auth/user_auth/admin_auth) — simpler than Cognito+API Gateway.

**When a user says → they mean:**
- "I need Cognito/Auth0" → Authentication & User Management
- "I need user sign-up/login" → Authentication & User Management
- "I need SSO" → Authentication with custom SSO

### API Gateway
| Equivalent | Platform |
|---|---|
| Amazon API Gateway | AWS |
| Google Cloud API Gateway | GCP |
| Azure API Management | Azure |
| Kong | Kong |
| Tyk | Tyk |

**Key differences:**
- Path-based routing to functions, rate limiting, CORS, auth enforcement.
- Simpler than AWS API Gateway — no stages, no usage plans, no Lambda authorizers.
- Configured via console or CLI.

---

## Communication

### Mail (Email Sending)
| Equivalent | Platform |
|---|---|
| Amazon SES | AWS |
| SendGrid | Twilio |
| Mailgun | Sinch |
| Postmark | Postmark |
| Resend | Resend |

### Push Notifications
| Equivalent | Platform |
|---|---|
| Amazon SNS (mobile push) | AWS |
| Firebase Cloud Messaging (FCM) | Firebase |
| Azure Notification Hubs | Azure |
| OneSignal | OneSignal |
| Pusher | Pusher |

---

## Quick Lookup Table

| Catalyst Service | Closest AWS | Closest GCP | Closest Azure | Other Equivalents |
|---|---|---|---|---|
| **Functions** | Lambda | Cloud Functions | Functions | Cloudflare Workers, Vercel Functions |
| **AppSail** | App Runner | Cloud Run | App Service | Heroku, Railway, Render, Fly.io |
| **Data Store** | RDS | Cloud SQL | SQL Database | Supabase Postgres, PlanetScale |
| **Stratus** | S3 | Cloud Storage | Blob Storage | Cloudflare R2, DigitalOcean Spaces |
| **NoSQL** | DynamoDB | Firestore | Cosmos DB | MongoDB Atlas |
| **Cache** | ElastiCache | Memorystore | Cache for Redis | Upstash, Vercel KV |
| **Search** | OpenSearch | — | — | Algolia, Typesense, Meilisearch |
| **Slate** | Amplify Hosting | Firebase Hosting | Static Web Apps | Vercel, Netlify, Cloudflare Pages |
| **Circuits** | Step Functions | Cloud Workflows | Logic Apps | Temporal, Inngest |
| **Job Scheduling** | SQS + Lambda | Cloud Tasks | Queue + Functions | BullMQ, Inngest |
| **Signals** | EventBridge | Pub/Sub | Event Grid | Kafka, RabbitMQ |
| **Pipelines** | CodePipeline | Cloud Build | Azure Pipelines | GitHub Actions, GitLab CI |
| **SmartBrowz** | Lambda+Puppeteer | — | — | Browserless, Apify |
| **ConvoKraft** | Lex | Dialogflow | Bot Service | Botpress, Rasa |
| **QuickML** | SageMaker Canvas | AutoML | ML Designer | DataRobot, H2O |
| **Zia OCR** | Textract | Vision OCR | Computer Vision | — |
| **Zia Text Analytics** | Comprehend | Natural Language | Text Analytics | — |
| **Zia Image** | Rekognition | Vision API | Computer Vision | Clarifai |
| **Auth & Users** | Cognito | Firebase Auth | AD B2C | Auth0, Clerk, Supabase Auth |
| **API Gateway** | API Gateway | API Gateway | API Management | Kong, Tyk |
| **Connections** | Secrets Manager | Secret Manager | Key Vault | — |
| **Mail** | SES | — | — | SendGrid, Resend, Postmark |
| **Push Notifications** | SNS | FCM | Notification Hubs | OneSignal |
| **CodeLib** | Serverless App Repo | — | — | Vercel Templates |
| **DevOps/Logs** | CloudWatch | Cloud Logging | Monitor | Datadog, New Relic |
| ~~File Store~~ | ~~S3 (simplified)~~ | — | — | **DEPRECATED → use Stratus** |
| ~~Event Listeners~~ | ~~EventBridge rules~~ | — | — | **DEPRECATED → use Signals** |
| ~~Cron~~ | ~~EventBridge Scheduler~~ | — | — | **DEPRECATED → use Job Scheduling** |

---

## Catalyst as a Full Platform (Holistic Comparison)

Unlike AWS/GCP/Azure where you assemble services yourself, Catalyst is a **unified platform**
(closer in philosophy to these full-stack platforms):

| Full-Stack Platform | Similarity to Catalyst |
|---|---|
| **Supabase** | Database + Auth + Storage + Functions + Realtime — similar integrated model |
| **Firebase** | Auth + Firestore + Storage + Functions + Hosting — similar BaaS philosophy |
| **AWS Amplify** | Frontend hosting + Auth + API + Storage — similar full-stack DX |
| **Vercel** | Frontend + Serverless + Storage + KV — but no built-in relational DB |
| **Netlify** | Frontend + Functions + Identity + Forms — similar but less backend depth |
| **Railway** | Full-stack hosting + DB + Redis — similar simplicity, different model |

**Catalyst's unique position:** It's the only platform that natively integrates with the entire
Zoho product ecosystem (CRM, Books, Desk, People, Analytics, etc.) via Signals and Connections.
For businesses already using Zoho products, this eliminates the "glue code" problem entirely.
