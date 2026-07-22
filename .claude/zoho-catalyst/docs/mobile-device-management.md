FILE_PURPOSE: Read when hosting, distributing, or managing Android/iOS mobile apps in Catalyst MDM, including APNs setup, versioning, and user invites.
TRIGGER_KEYWORDS: MDM, mobile device management, APK, IPA, APNs, mobile app hosting, ManageEngine MDM, app versioning, Android app, iOS app, MDM invite
SOURCE_DOC: help-docs/mobile-device-management.md

TECHNICAL_CONSTRAINTS:
- NOT available in EU, AU, IN, JP, SA, CA data centers (6 DCs blocked)
- Max: 1 Android app + 1 iOS app per Catalyst project
- Live distribution: production environment only; dev environment allows hosting for testing but app is NOT available live
- No CLI commands for MDM — all operations are console-only
- iOS: requires APNs certificate from Apple; one certificate per Catalyst project (separate for each project)
- APNs certificate must be renewed before expiry; a new certificate upload is required
- Android: upload APK file; iOS: upload IPA file
- Logo image: JPEG format only, max 50KB
- Version number: specified in decimal format; cannot be decreased after hosting (version rollback must be done manually by deploying an older IPA/APK)
- Cannot roll back to a previous version from the Catalyst console (unlike web client hosting)
- MDM cannot be disabled once enabled for a project
- iOS users: must be authenticated via Catalyst Auth to receive push notifications from the app

REQUIRED_PARAMETERS:
- Android: App Name + APK file + logo (JPEG ≤50KB) + description + version in build.gradle (versionName field)
- iOS: App Name + IPA file + APNs certificate + logo (JPEG ≤50KB) + description + version in contents.json (version field)
- Invites: select from Zoho CRM or Zoho Desk organization members (must specify organization)

UI_ONLY_ACTIONS:
- Enable MDM: Console → Cloud Scale → Host & Manage → MDM → Enable Now → Proceed (one-time; irreversible)
- Host Android app: Console → MDM → Upload → select Android → upload APK + logo → enter name/description → Upload
- Host iOS app: Console → MDM → Upload → select iOS → upload IPA + APNs certificate + logo → enter name/description → Upload
- Update app (new version): Console → MDM → Android/iOS section → Upload (new version) → upload new file → Upload
- View version history: Console → MDM → Android/iOS section → App Version History
- Send invite: Console → MDM → Invites → send invite → select service (CRM/Desk) + organization → select users → Send
- Send invite from Auth: Console → Authentication → Users → select user → send MDM invite

CRITICAL_FAILURE_MODES:
- Accessing MDM in blocked DC: MDM section absent from console in EU/AU/IN/JP/SA/CA — no workaround
- Hosting in dev and expecting live app: app hosted in dev is not publicly accessible; must deploy project to production and host in production environment
- Uploading IPA without APNs certificate: iOS hosting fails; certificate is mandatory for first upload and whenever certificate expires
- Logo not in JPEG or exceeding 50KB: upload rejected
- Version number decreased: platform rejects upload; version can only increment
- Uploading APK/IPA from different bundle: rejected silently or causes compatibility issues; bundle ID must match existing app
- MDM enabled — cannot be undone: no disable option after enabling; plan carefully before enabling on a project
