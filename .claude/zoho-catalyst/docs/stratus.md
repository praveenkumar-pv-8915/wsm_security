FILE_PURPOSE: Read when creating buckets, uploading/downloading objects, configuring permissions, or using advanced Stratus features like versioning, encryption, or multipart upload.
TRIGGER_KEYWORDS: Stratus, bucket, object, Bucket URL, Object URL, Stratus permissions, versioning, PII ePHI, multipart upload, Transfer Manager, data encryption, malware scan, Stratus SDK
SOURCE_DOC: help-docs/stratus.md

TECHNICAL_CONSTRAINTS:
- Bucket: unlimited object storage; each bucket has a unique Bucket URL
- Object: any file format; each object has a unique Object URL; path (directory-like structure) is supported
- Bucket permission templates (required at creation time):
  - Authenticated: objects accessible only by authenticated project users
  - Public: objects accessible by anyone on the internet without auth
  - CRITICAL: regardless of permission template, UPLOAD actions always require authenticated users (even on Public buckets)
- Custom permissions: JSON-based; can be set per object or per sub-directory; overrides default template for that path
- Permissions apply to project users only — not Collaborators or Admins
- Optional bucket settings (configured at creation or after):
  - Versioning: multiple versions per object; each version has unique version ID
  - Data Encryption: encryption at rest AND in transit
  - PII/ePHI: HIPAA-compliant; every object access is logged in Audit Logs
- Safety Scanning: runs continuously; malware detected → object IMMEDIATELY and PERMANENTLY deleted; email notification sent to user, admin, super admin, project owner
- Multipart upload: supported for large objects; parts upload in parallel; if parts not specified, Catalyst auto-splits object
- Transfer Manager download: byte-range downloads for large objects (specify start/end byte)
- Third-party migration: import from Amazon S3 and Google Cloud Platform Cloud Storage
- Server SDKs: Java, Node.js, Python
- Client SDKs: Web, Android, iOS, Flutter
- Bulk Write (Data Store): uses Stratus bucket as CSV source (relevant cross-reference: docs/data-store.md)

REQUIRED_PARAMETERS:
- Bucket creation: bucket name + permission template (Authenticated or Public)
- Custom permission JSON structure:
  ```json
  {
    "rules": [{
      "rule_id": "RuleName",
      "condition": { "user": { "auth_type": "authenticated", "zuid": "*" } },
      "allowed_actions": ["GetObject"],
      "paths": ["bucketname::/*"],
      "effect": "allow"
    }],
    "version": "v1"
  }
  ```
- SDK (Node.js):
  ```js
  const stratus = app.stratus();
  const bucket = stratus.bucket('bucket-name');
  await bucket.uploadObject({ objectName: 'file.pdf', content: buffer });
  const url = await bucket.getSignedURL('file.pdf');
  ```

UI_ONLY_ACTIONS:
- Create bucket: Console → Cloud Scale → Stratus → Create Bucket → enter name → select permission template → optional settings (versioning/encryption/PII) → Create
- Upload object: Console → Stratus → open bucket → Upload → select file → Upload
- Set custom permissions: Console → Stratus → open bucket → Permissions → edit JSON → Save
- Enable versioning (existing bucket): Console → Stratus → open bucket → Settings → enable Versioning → Save
- Migrate from S3/GCP: Console → Stratus → Migrate → select source (S3/GCP) → enter credentials + bucket → Start Migration
- View Audit Logs (PII/ePHI): Console → Audit Logs → filter by Stratus operations

CRITICAL_FAILURE_MODES:
- Upload from unauthenticated client to Public bucket: BLOCKED — even Public buckets require authenticated users for upload; implement user auth flow before upload
- Malware in uploaded object: object is deleted immediately and permanently without warning to uploader; no recovery possible — implement client-side validation before upload
- Custom permission JSON syntax error: Stratus silently falls back to default template or rejects the save; validate JSON structure before applying
- PII/ePHI not enabled at bucket creation: audit logging does not retroactively apply; must be configured at creation or enabled later (check if enabling on existing bucket is supported)
- Versioning not enabled: once an object is overwritten, previous version is permanently lost; enable versioning before first upload if history is needed
- SDK call with wrong bucket name: returns 404; verify exact bucket name from console — names are case-sensitive
