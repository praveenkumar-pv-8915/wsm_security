# Hacksaw Violations API Integration

## Overview

This integration fetches vulnerable components (violations) from Hacksaw, a Zoho internal security scanning product. The API retrieves Software Composition Analysis (SCA) data about vulnerable dependencies in your application.

## API Endpoint

```
GET /api/hacksaw/violations
```

## Authentication

Uses Hacksaw Basic Auth credentials from environment variables:
- `ZOHO_HACKSAW_CLIENT_ID_IN` (India region)
- `ZOHO_HACKSAW_CLIENT_SECRET_IN`
- Similar for US (`_US`) and EU (`_EU`) regions

## Query Parameters

### Required

- **organisation** (string): The organization name to fetch violations for

### Optional

- **filter** (JSON string): Advanced filtering criteria. Should be a JSON object stringified.

## Filter Options

Pass as a JSON object with any of the following keys:

```javascript
{
  "SLA_PROFILE": ["ZOHO"],                                    // array
  "COMPONENT": ["JAR", "JS", "PYTHON_PACKAGE"],              // array
  "STATUS": ["OPEN", "FALSE_POSITIVE", "TEMPORARILY_EXCLUDED", "PERMANENTLY_EXCLUDED"], // array
  "SEVERITY_SCORE": {                                         // object
    "MIN_SCORE": 0,
    "MAX_SCORE": 10
  },
  "OWNERSHIP": ["component-name"],                            // array (max-len: 500)
  "TAG": ["own", "internal-dependency", "third-party"],       // array
  "TYPE": ["BLOCKING", "NON_BLOCKING"]                        // array
}
```

## Example Requests

### Fetch all violations for an organization

```bash
curl "http://localhost:8000/api/hacksaw/violations?organisation=my-org"
```

### Fetch with severity filter (CVSS 5.0 and above)

```bash
curl "http://localhost:8000/api/hacksaw/violations?organisation=my-org&filter=%7B%22SEVERITY_SCORE%22%3A%7B%22MIN_SCORE%22%3A5%2C%22MAX_SCORE%22%3A10%7D%7D"

# Or decoded:
curl "http://localhost:8000/api/hacksaw/violations?organisation=my-org&filter={\"SEVERITY_SCORE\":{\"MIN_SCORE\":5,\"MAX_SCORE\":10}}"
```

### Fetch only open JAR violations

```bash
curl "http://localhost:8000/api/hacksaw/violations?organisation=my-org&filter={\"COMPONENT\":[\"JAR\"],\"STATUS\":[\"OPEN\"]}"
```

## Response Format

### Success Response (200)

```json
{
  "success": true,
  "profile": "in",
  "service": "hacksaw",
  "organisation": "my-org",
  "filter": {},
  "status": 200,
  "components": [
    {
      "COMPONENT_AUTO_ID": 12345,
      "NAME": "log4j",
      "VERSION": "1.2.17",
      "PATH": "AdventNet/Sas/tomcat/webapps/ROOT/WEB-INF/lib/log4j-1.2.17.jar",
      "STATUS": "OPEN",
      "OWNERSHIP": "log4j",
      "VULNERABILITY_COUNT": 5,
      "SEVERITY_SCORE": 9.8,
      "CPE_IDENTIFIERS": ["cpe:2.3:a:apache:log4j:1.2.17:*:*:*:*:*:*:*"],
      "PURL_IDENTIFIERS": ["pkg:maven/log4j/log4j@1.2.17"],
      "IS_BLOCKED": false,
      "EOL_STATUS": "EOLED",
      "EOL_DATE": "2015-06-01",
      "RELEASED_DATE": "2012-04-02",
      "COMPONENT_AGE": "11 years",
      "IDENTIFIERS": {...},
      "FILE_HASH": [...]
    }
    // ... more components
  ],
  "total_count": 42
}
```

### Error Response (400/503)

```json
{
  "error": "Failed to fetch Hacksaw violations",
  "message": "organisation parameter is required"
}
```

## Component Object Fields

| Field | Type | Description |
|-------|------|-------------|
| COMPONENT_AUTO_ID | Long | Unique component identifier |
| NAME | String | Component name (e.g., "log4j") |
| VERSION | String | Component version |
| PATH | String | File path where component is located |
| STATUS | String | Status: OPEN, FALSE_POSITIVE, TEMPORARILY_EXCLUDED, PERMANENTLY_EXCLUDED |
| OWNERSHIP | String | Component ownership info |
| VULNERABILITY_COUNT | int | Number of vulnerabilities in this component |
| SEVERITY_SCORE | float | CVSS score (0-10) |
| CPE_IDENTIFIERS | String[] | Common Platform Enumeration identifiers |
| PURL_IDENTIFIERS | String[] | Package URL identifiers |
| IS_BLOCKED | boolean | Whether component is blocked |
| EOL_STATUS | String | EOLED, TO_BE_EOLED, or NOT_AVAILABLE |
| EOL_DATE | String | End-of-Life date |
| RELEASED_DATE | String | Release date |
| COMPONENT_AGE | String | Age of the component |
| FILE_HASH | JSONArray | Hash details of the component |
| IDENTIFIERS | JSONObject | Additional identifiers |

## Local Testing

### Setup

1. Ensure Hacksaw credentials are set in `.env`:
   ```
   ZOHO_HACKSAW_CLIENT_ID_IN=your_credentials
   ZOHO_HACKSAW_CLIENT_SECRET_IN=your_credentials
   ```

2. Install dependencies:
   ```bash
   cd backend
   npm install
   ```

### Test Script

Run the included test script:

```bash
# Basic test
node backend/test-violations.js "my-org"

# With filter
node backend/test-violations.js "my-org" '{"SEVERITY_SCORE":{"MIN_SCORE":5,"MAX_SCORE":10}}'
```

### Manual Testing

Start the server:
```bash
cd backend
node functions/server/index.js
```

Then test the endpoint:
```bash
curl "http://localhost:8000/api/hacksaw/violations?organisation=my-org"
```

## Integration with Frontend

Example usage in a React/Ember component:

```javascript
async function fetchViolations(organisation, filters = {}) {
  const query = new URLSearchParams();
  query.append('organisation', organisation);
  
  if (Object.keys(filters).length > 0) {
    query.append('filter', JSON.stringify(filters));
  }

  const response = await fetch(`/api/hacksaw/violations?${query}`);
  
  if (!response.ok) {
    throw new Error('Failed to fetch violations');
  }
  
  return response.json();
}

// Usage
const data = await fetchViolations('my-org', {
  SEVERITY_SCORE: { MIN_SCORE: 5, MAX_SCORE: 10 },
  STATUS: ['OPEN']
});

console.log(`Found ${data.total_count} vulnerable components`);
```

## Error Handling

### Common Errors

| Error | Cause | Solution |
|-------|-------|----------|
| Missing required parameter | `organisation` not provided | Include `organisation` in query parameters |
| Invalid filter parameter | Filter is not valid JSON | Ensure filter is properly JSON-encoded |
| Hacksaw API error | Auth failure or API error | Check credentials and Hacksaw service status |
| Connection manager not available | Config not initialized | Ensure connections.config.json exists |

## Rate Limiting

Hacksaw enforces rate limits:
- **Limit**: 50 requests per minute
- **Duration**: 1 minute
- **Lock period**: 5 minutes after limit exceeded
- **Scope**: By IP address

## Related Endpoints

- `GET /api/hacksaw/products` - Fetch list of scanned products
- `GET /api/health` - Check service health status

## Additional Resources

- [Hacksaw Documentation](https://learn.zoho.in/portal/zohocorp/knowledge/manual/api-6/article/fetch-summary-1)
- [ConnectionManager](./backend/functions/server/connections.js) - OAuth and API integration