# Zoho Repository Webhook Setup

Expose the WSM-Security API as a webhook endpoint for Zoho Repository to send events.

## **Webhook Endpoint**

```
POST /webhook/zoho/repository
```

**URL (Production):**
```
https://wsm-security-60073792083.development.catalystserverless.in/server/server/execute/webhook/zoho/repository
```

**URL (Local Development):**
```
http://localhost:8000/webhook/zoho/repository
```

---

## **Webhook Events**

The webhook receives events from Zoho Repository:

- **Repository Created** — New repository created
- **Repository Updated** — Repository details changed
- **Push Event** — Code pushed to repository
- **Pull Request** — Pull request created/updated
- **Issue** — Issue created/commented
- **Release** — Release published
- **Branch** — Branch created/deleted

---

## **Payload Format**

Zoho Repository sends webhook payloads as JSON:

```json
{
  "webhook_id": "webhook_12345",
  "event_type": "push",
  "timestamp": "2026-06-19T10:30:00Z",
  "repository": {
    "id": "repo_123",
    "name": "my-repo",
    "full_name": "org/my-repo",
    "url": "https://..."
  },
  "action": "created/updated/deleted",
  "data": {
    // Event-specific data
  }
}
```

---

## **Configure in Zoho Repository**

### **Step 1: Get Your Webhook URL**

For **development** (local testing):
```
http://localhost:8000/webhook/zoho/repository
```

For **production** (Catalyst deployed):
```
https://wsm-security-60073792083.development.catalystserverless.in/server/server/execute/webhook/zoho/repository
```

### **Step 2: Add Webhook in Zoho Repository**

1. Go to **Your Repository** → **Settings** → **Webhooks**
2. Click **Add Webhook**
3. Fill in:
   - **Payload URL:** Paste your webhook URL
   - **Content Type:** `application/json`
   - **Events:** Select events to trigger webhook
     - ✅ Push events
     - ✅ Pull requests
     - ✅ Issues
     - ✅ Releases
4. Click **Add Webhook**

---

## **Test the Webhook**

### **Manual Test (with curl)**

```bash
curl -X POST http://localhost:8000/webhook/zoho/repository \
  -H "Content-Type: application/json" \
  -d '{
    "webhook_id": "webhook_test_123",
    "event_type": "push",
    "timestamp": "2026-06-19T10:30:00Z",
    "repository": {
      "id": "repo_123",
      "name": "test-repo"
    },
    "action": "created",
    "data": {
      "branch": "main",
      "commits": 1
    }
  }'
```

**Expected Response:**
```json
{
  "success": true,
  "webhook_id": "webhook_test_123",
  "event_type": "push",
  "timestamp": "2026-06-19T10:30:00Z",
  "message": "Webhook received and queued for processing"
}
```

### **Test via Zoho Repository UI**

1. Go to **Settings** → **Webhooks**
2. Find your webhook
3. Click **Test Delivery**
4. Choose an event type
5. Check the response

---

## **Webhook Response**

The endpoint acknowledges receipt immediately:

```json
{
  "success": true,
  "webhook_id": "webhook_12345",
  "event_type": "push",
  "timestamp": "2026-06-19T10:30:00Z",
  "message": "Webhook received and queued for processing"
}
```

**Status codes:**
- `200` — Success, event received
- `400` — Bad request (invalid payload)
- `500` — Server error

---

## **Event Processing**

### Current Behavior
Events are:
1. ✅ Received and logged
2. ✅ Validated for required fields
3. ✅ Acknowledged immediately (HTTP 200)
4. ⏳ Queued for processing (TODO: store in Datastore)

### Next Steps
- [ ] Connect to Catalyst Datastore (store events)
- [ ] Process events asynchronously
- [ ] Send confirmations when processing completes
- [ ] Add retry logic for failed events
- [ ] Add event filtering/routing

---

## **Security Notes**

⚠️ **Current Configuration:**
- ✅ Public endpoint (no authentication required)
- ✅ Validates JSON payload
- ✅ Logs all events
- ❌ No signature verification (TODO)
- ❌ No rate limiting (TODO)

### Future Improvements
1. **Add API Key authentication**
   - Zoho Repository sends `X-Webhook-Signature` header
   - Verify signature using shared secret

2. **Add rate limiting**
   - Prevent abuse from repeated webhook calls

3. **Add event filtering**
   - Accept only specific event types
   - Reject unknown events

---

## **Webhook Headers**

Zoho Repository sends standard webhook headers:

```
Host: your-domain.com
User-Agent: ZohoRepository/1.0
Content-Type: application/json
Content-Length: {payload_size}
X-Webhook-ID: webhook_12345
X-Event-Type: push
```

---

## **Troubleshooting**

### ❌ "Connection refused"
- Webhook URL is incorrect
- Backend is not running
- Firewall blocking the connection

### ❌ "400 Bad Request"
- JSON payload is malformed
- Missing required fields

### ❌ "500 Server Error"
- Check backend logs for detailed error

### ✅ Webhook successful?
- Check `/webhook/zoho/repository` endpoint logs
- Verify HTTP 200 response
- Event data is being received

---

## **Webhook Events Reference**

| Event | Triggered When | Payload Includes |
|-------|----------------|------------------|
| `push` | Code pushed to branch | commit hash, branch, files changed |
| `pull_request` | PR created/updated | PR number, title, base branch |
| `issue` | Issue created/updated | issue number, title, description |
| `release` | Release published | version, tag, changelog |
| `repository` | Repo settings changed | repo name, visibility, description |
| `branch` | Branch created/deleted | branch name, action |

---

## **Example Implementations**

### Process webhook events asynchronously

```javascript
// Store webhook in queue for processing
const eventData = {
  webhook_id: payload.webhook_id,
  event_type: eventType,
  timestamp: new Date().toISOString(),
  payload: payload,
  status: 'pending',
};

// TODO: Save to Catalyst Datastore
// await db.webhookEvents.create(eventData);

// TODO: Trigger async job
// await queue.enqueue('process_webhook', eventData);
```

### Process and store webhook data

```javascript
// Extract relevant data from webhook
const repositoryData = {
  repo_id: payload.repository.id,
  repo_name: payload.repository.name,
  event_type: payload.event_type,
  action: payload.action,
  timestamp: payload.timestamp,
};

// TODO: Store in Catalyst Datastore
// await db.repositoryEvents.create(repositoryData);
```

---

## **Next Steps**

1. ✅ Webhook endpoint exposed
2. ✅ Receives events from Zoho Repository
3. ✅ Acknowledges receipt
4. 📋 TODO: Connect to Catalyst Datastore
5. 📋 TODO: Add signature verification
6. 📋 TODO: Add event processing logic
7. 📋 TODO: Add retry mechanism

Ready to deploy and test! 🚀
