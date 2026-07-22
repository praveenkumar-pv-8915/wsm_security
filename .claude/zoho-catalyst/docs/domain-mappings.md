FILE_PURPOSE: Read when configuring custom domains for Catalyst apps — adding domains, setting up CNAME records, managing SSL, or troubleshooting domain activation.
TRIGGER_KEYWORDS: domain mapping, custom domain, CNAME, SSL certificate, subdomain, catalyst.cs.zohohost.com, Group SSL, domain activation, base domain
SOURCE_DOC: help-docs/domain-mappings.md

TECHNICAL_CONSTRAINTS:
- Max 5 custom domains per app
- Production environment only — domain mappings cannot be created or managed from dev environment
- Subdomains only — base domains (e.g., example.com) are NOT supported; must use subdomain (e.g., app.example.com)
- Requires 2 CNAME records:
  1. subdomain → catalyst.cs.zohohost.com
  2. hash_key.subdomain → catalyst.cs.zohohost.com (hash key provided in console after adding domain)
- Group SSL certificate: mandatory, free, must be requested via email to support@zohocatalyst.com; activation takes up to 48 hours
- Default Catalyst URL remains active after custom domain is mapped — both URLs resolve simultaneously
- Disable and delete operations only available from production environment

REQUIRED_PARAMETERS:
- Custom domain: subdomain format required (e.g., app.yourdomain.com)
- CNAME record 1: Name = subdomain, Value = catalyst.cs.zohohost.com
- CNAME record 2: Name = hash_key.subdomain (hash provided by Catalyst console), Value = catalyst.cs.zohohost.com
- SSL: Group SSL certificate — email support@zohocatalyst.com with project details to request

UI_ONLY_ACTIONS:
- Add custom domain: Console (Production) → Web Client → Domain Mapping → Add Domain → enter subdomain → Save → copy hash key
- Verify domain: Console → Domain Mapping → domain row → Verify → status changes to Active after DNS propagation + SSL activation
- Disable domain: Console (Production) → Domain Mapping → domain row → Disable
- Delete domain: Console (Production) → Domain Mapping → domain row → Delete → confirm
- Note: No CLI or API for domain mapping management

CRITICAL_FAILURE_MODES:
- Attempting domain management from dev environment: Domain Mapping section not available in dev; must switch to production environment
- Using a base domain (no subdomain): not supported; Catalyst rejects non-subdomain entries
- Missing second CNAME (hash record): SSL verification fails; domain stays in pending state indefinitely
- SSL not requested: domain may resolve but without HTTPS; must separately request Group SSL certificate
- SSL activation delay: up to 48 hours after Catalyst team provisions certificate; domain shows Active in DNS but HTTPS fails until SSL is live
- Exceeding 5 domains: add button disabled after 5th domain; must delete an existing mapping first
