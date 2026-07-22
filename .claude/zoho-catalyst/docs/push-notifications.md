FILE_PURPOSE: Read when implementing push notifications for web, iOS, or Android apps in Catalyst — configuring APNs/FCM, registering devices, or sending notifications via SDK/API.
TRIGGER_KEYWORDS: Push Notifications, APNs, FCM, Firebase Cloud Messaging, device token, APNs certificate, service worker, push notification SDK, register device, sendPushNotification
SOURCE_DOC: help-docs/push-notifications.md

TECHNICAL_CONSTRAINTS:
- Platforms: Web (service worker / browser push), iOS (APNs), Android (FCM), Flutter
- iOS:
  - Requires APNs certificate obtained from Apple; one certificate per Catalyst project (separate for each project)
  - Certificate must be regenerated and re-uploaded before expiry
  - End users must be authenticated via Catalyst Auth to receive push notifications
  - Dev mode vs Production mode: separate Apple servers — NOT the same as Catalyst dev/production environments; selecting dev mode sends to Apple's test servers
  - Device must be registered with APNs; user must grant explicit notification permission
- Android: uses Firebase Cloud Messaging (FCM); requires Firebase configuration (google-services.json or equivalent)
- Web: browser-specific push service; most browsers impose no heavy limits; Safari uses APNs
- No limit from Catalyst on notification count (iOS limits set by Apple, Android by Google, Web by browser)
- SDK architecture: client-side (registration) + server-side (sending)
  - Client SDKs: iOS SDK, Android SDK, Flutter SDK, Web SDK — for device registration/deregistration
  - Server SDKs: Java, Node.js, Python — for sending notifications
- Test devices: register specific devices for pre-production testing from console or API

REQUIRED_PARAMETERS:
- iOS: APNs certificate (upload to console); device token (obtained from APNs on app launch, stored in Catalyst)
- Android: FCM server key or service account credentials configured in console
- Send notification (Node.js):
  ```js
  const push = app.push();
  await push.sendPushNotification({ to: [deviceToken], title: 'Title', body: 'Message' });
  ```
- Notification payload: title, body; rich media (images, CTAs, audio/video) passed as JSON package

UI_ONLY_ACTIONS:
- Configure iOS APNs: Console → Cloud Scale → Notify → Push Notifications → iOS tab → upload APNs certificate → Save
- Configure Android FCM: Console → Push Notifications → Android tab → upload Firebase config → Save
- Configure Web push: Console → Push Notifications → Web tab → follow web SDK setup instructions
- Send test notification (iOS): Console → Push Notifications → iOS → Test → enter device token + message + mode (dev/production) → Send
- Send test notification (Android): Console → Push Notifications → Android → Test → enter device token + message → Send
- Send test notification (Web): Console → Push Notifications → Web → Test → enter device token + message → Send
- Register test device: Console → Push Notifications → Test Devices → Add Device → enter email + device token
- Note: Sending notifications programmatically via server-side SDK or API; device registration via client SDK

CRITICAL_FAILURE_MODES:
- iOS: user not authenticated in Catalyst Auth: push notification not delivered — iOS end users must be authenticated
- iOS dev mode vs production mode confusion: sending in dev mode uses Apple's test servers (sandbox); production apps must use production mode; mismatching mode silently fails delivery
- APNs certificate expired: iOS push delivery stops entirely; must generate new certificate from Apple and re-upload
- iOS: separate APNs certificate per project: sharing a certificate across projects is not supported; each project needs its own Apple certificate
- FCM not configured for Android: Android push fails with auth error at send time
- Web: service worker not registered in app code: push events are not received even if notification is sent successfully by server; client-side SDK setup is required
- Not granting permission (iOS/Android): device not registered with APNs/FCM; notifications silently not delivered to that device
