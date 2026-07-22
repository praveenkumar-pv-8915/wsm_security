FILE_PURPOSE: Read when configuring sender email addresses, domain verification, SMTP settings, or sending emails from Catalyst via SDK or API.
TRIGGER_KEYWORDS: Mail, sendMail, send_mail, from_email, ZohoCatalyst.email.CREATE, DKIM, SPF, SMTP, email verification, domain verification, email attachment
SOURCE_DOC: help-docs/mail.md

TECHNICAL_CONSTRAINTS:
- Both email address AND domain must be verified before sending; either alone is insufficient
- Public domain email addresses (Gmail, Outlook, Apple Mail): can be used directly without SMTP config (but delivery not guaranteed; may land in spam)
- Yahoo Mail and some public domains: cannot be used without SMTP configuration
- Private/custom domains: must add DKIM and SPF records to DNS; authenticate domain in console
- SMTP ports available: 25, 465, 587, 2525
- SMTP security modes: SSL, TLS, or None
- Per-send-operation limits:
  - To: max 10 recipients
  - CC: max 10
  - BCC: max 5
  - Reply-to: max 5
  - Attachments: max 5 files, max 15MB total
- API scope required: `ZohoCatalyst.email.CREATE`
- API URL: `{api-domain}/baas/v1/project/{project_id}/email/send` (POST, multipart/form-data)
- Built-in email client: powered by Zoho Mail; can be disabled/replaced with SMTP

REQUIRED_PARAMETERS:
- API form-data fields: `from_email` (mandatory), `to_email` (at least one mandatory), `subject` (mandatory), `content` (optional), `cc`, `bcc`, `reply_to`, `attachments`, `html_mode` (true/false), `display_name`
- Node.js SDK:
  ```js
  const email = app.email();
  await email.sendMail({
    from_email: 'sender@domain.com',
    to_email: ['recipient@domain.com'],
    subject: 'Subject',
    content: 'Body',
    html_mode: true
  });
  ```
- Python SDK:
  ```python
  mail_service = app.email()
  mail_service.send_mail({'from_email': '...', 'to_email': [...], 'subject': '...', 'content': '...'})
  ```
- Java SDK: `ZCMail.getInstance().sendMail(mailContent)` where `mailContent` is a `ZCMailContent` object

UI_ONLY_ACTIONS:
- Add email address: Console → Cloud Scale → Notify → Mail → Email Configuration → Add Email Address → enter name + address → Add Email
- Verify email address: Console → Mail → Email Configuration → Click to confirm → enter code from email → Confirm
- Add custom domain: Console → Mail → Domain tab → Add Domain → enter domain email address → Create
- Verify domain: Console → Mail → Domain → Verify Code → enter confirmation code → Confirm
- Authenticate domain (DKIM/SPF): Console → Mail → Domain → Validate → copy SPF and DKIM codes → add to DNS settings at domain host → Authenticate
- Configure SMTP: Console → Mail → SMTP Configuration tab → Add SMTP → enter host, port, credentials, security mode → Save
- Disable/enable SMTP: Console → Mail → SMTP Configuration → toggle switch

CRITICAL_FAILURE_MODES:
- Sending without domain verification: throws exception at runtime; mail is not sent and no retry occurs
- Sending without email address verification: same as above — exception thrown, no delivery
- Yahoo Mail without SMTP: cannot be used directly in Catalyst; must configure SMTP settings first
- Exceeding recipient/attachment limits: API/SDK returns error; check all limits before sending bulk operations
- Domain DNS propagation delay: DKIM/SPF records may take hours to propagate after adding to DNS host; clicking Authenticate before propagation completes will fail
- `html_mode` not set for HTML content: email renders raw HTML tags as literal text; set `html_mode: true` when sending HTML content
