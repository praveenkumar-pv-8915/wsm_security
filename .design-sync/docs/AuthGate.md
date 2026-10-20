---
category: Shell
---

Session gate wrapping the whole app. Renders a sign-in, denied, not-authorized or error panel until Catalyst confirms a @zohocorp.com session, then renders children(user). Outside a Catalyst-hosted origin it shows its error state.
