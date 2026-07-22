FILE_PURPOSE: Read when implementing in-memory caching in Catalyst — creating segments, reading/writing cache items, or debugging cache expiry issues.
TRIGGER_KEYWORDS: Cache, cache segment, cache item, Segment ID, default segment, Redis, ephemeral data, cache expiry
SOURCE_DOC: help-docs/cache.md

TECHNICAL_CONSTRAINTS:
- Backed by Redis; managed multi-tenant cluster, Catalyst handles segregation
- Default cache item expiry: 2 days (hard default); can be overridden but only to a value LESS THAN OR EQUAL TO 2 days — cannot set expiry longer than 2 days
- Max cache item value size: 32 KB
- Segments can ONLY be created from the Catalyst console — not via SDK or API
- Default segment: automatically created per project; used when no Segment ID is specified in SDK/API calls
- Segment ID: auto-generated on creation; required to target specific segments in code
- Cache items are key-value pairs; keyname must be unique within a segment
- Cache item attributes: keyname (string), value, expiration time (hours)
- SDK available: Java, Node.js, Python

REQUIRED_PARAMETERS:
- Segment ID: required to target non-default segments; find in Console → Cloud Scale → Cache → segment details
- Cache item: keyname (string, unique per segment), value, optional expiration time (hours, max 48)
- SDK init: obtain app instance first, then `app.cache()` (Node.js) or equivalent

UI_ONLY_ACTIONS:
- Create segment: Console → Cloud Scale → Cache → Create Segment → enter name → Create
- Rename segment: Console → Cache → click segment → ellipsis → Rename
- Delete segment: Console → Cache → click segment → ellipsis → Delete → confirm
- Create cache item: Console → Cache → select segment → Add Item → enter keyname, value, expiration → Add
- Edit cache item: Console → Cache → select segment → click item → Edit → update → Save
- Delete cache item: Console → Cache → select segment → click item → Delete → confirm
- View Segment ID: Console → Cache → click segment name → Segment ID shown in details
- Note: All read/write operations on cache items can be done via SDK or API; only segment creation is console-only

CRITICAL_FAILURE_MODES:
- Setting expiry > 48 hours: rejected; max is 2 days regardless of unit passed
- No Segment ID specified: silently uses default segment — cache items from different code paths may collide if all using default segment without namespaced keynames
- SDK only accessible inside Catalyst Functions/AppSail — calling cache SDK from external environments fails
- Cache item keynames are case-sensitive — `UserSession` and `usersession` are different keys
- Deleting a segment deletes all cache items in it permanently with no recovery
