FILE_PURPOSE: Read when creating folders, uploading/downloading files, setting permissions, or querying the Catalyst File Store via SDK or API.
TRIGGER_KEYWORDS: File Store, folder ID, file ID, file upload, file download, file permissions, ZohoCatalyst.folders.READ, Stratus, file store folder, file store bucket
SOURCE_DOC: help-docs/file-store.md

TECHNICAL_CONSTRAINTS:
- Storage limit: 1GB total in dev environment; no documented upper limit in production
- No subfolders: File Store is flat — folders cannot contain nested folders
- Folder ID and File ID: auto-generated on creation; required for all SDK/API calls
- Permissions per folder, per user role: Download, Upload, Delete (checkboxes in console)
- API scope required: ZohoCatalyst.folders.READ (for read operations); additional scopes for write/delete
- API base URL: `{api-domain}/baas/v1/project/{project_id}/folder/{folder_id}`
- File ID used for file-level operations: `{api-domain}/baas/v1/project/{project_id}/folder/{folder_id}/file/{file_id}`
- Stratus: newer object storage alternative (Early Access) — separate service, not the same as File Store; for large-scale/bulk use cases consider Stratus instead
- SDK accessible only inside Catalyst Functions and AppSail — not from local environments

REQUIRED_PARAMETERS:
- Folder ID: find at Console → Cloud Scale → File Store → click folder → shown in URL or folder details
- File ID: returned in upload response; also visible in console file listing
- SDK — Node.js upload:
  ```js
  const fileStore = app.fileStore();
  const folder = fileStore.folder(folderId);
  await folder.uploadFile({ fileName: 'name.txt', content: buffer });
  ```
- SDK — Node.js download:
  ```js
  const file = await folder.downloadFile(fileId);
  ```
- API upload: multipart/form-data POST to folder endpoint with file binary
- API download: GET `{base_url}/file/{file_id}/download`

UI_ONLY_ACTIONS:
- Create folder: Console → Cloud Scale → File Store → New Folder → enter name → Create
- Set folder permissions: Console → File Store → click folder → Permissions → configure per role → Save
- Upload file manually: Console → File Store → click folder → Upload File → select file → Upload
- Delete file: Console → File Store → click folder → file row → Delete → confirm
- Delete folder: Console → File Store → folder row → ellipsis → Delete → confirm (folder must be empty)
- Note: Upload, download, delete, and list operations all available via SDK and API

CRITICAL_FAILURE_MODES:
- Subfolder attempt: not supported; any folder created inside a folder will fail or be rejected — structure must be flat
- Wrong Folder ID in SDK/API call: returns 404 or permission error; verify exact Folder ID from console
- Missing API scope ZohoCatalyst.folders.READ: file listing and download calls return auth error
- Deleting non-empty folder from console: folder delete blocked until all files inside are removed
- 1GB dev limit reached: file uploads fail with storage quota error; check usage in console
- SDK call from local/external environment: fails; SDK requires Catalyst Functions or AppSail runtime context
- Stratus vs File Store confusion: they are separate services with different APIs and SDKs; do not mix endpoints
