/**
 * The connection catalogue — imported from the agent-knowledge-kit's
 * `src/connections/config.json` + per-service setup scripts.
 *
 * This is the *definition* layer: which services exist, how each authenticates, what scopes it
 * needs, and which host serves it per data centre. It holds NO secrets — credentials live in
 * `connection_credentials` (see connections-service.js), encrypted.
 *
 * These constants are THE source of truth, and the only one. They were briefly mirrored into
 * `connections` / `connection_profiles` DataStore tables "so the catalogue is queryable without a
 * redeploy" — but nothing ever read those tables (every read path goes through publicCatalogue(),
 * PROFILES, getService() and scopeString() right here), and the values only change by editing this
 * file and redeploying, so a mirror could never be anything but identical-or-stale.
 *
 * Scopes in particular stay in code on purpose: they decide what a token is allowed to do, so they
 * should change in a reviewed diff, not in a console row. `startOAuth` reads them from here, so a
 * second copy in a table could silently disagree with what is actually requested at consent.
 *
 * Where the kit stored tokens in each developer's macOS Keychain plus a local SQLite file, this
 * makes the catalogue team-wide and the credentials shared-or-personal (see SCOPE_LEVELS).
 */

/* ------------------------------------------------------------------ auth types */

const AUTH_TYPES = {
  OAUTH: 'oauth',                  // Zoho OAuth 2.0, refresh-token flow
  PRIVATE_TOKEN: 'private_token',  // static token in a PRIVATE-TOKEN header (CMTools)
  PAT: 'pat',                      // personal access token, Zoho-zapikey header (Repository)
};

/**
 * Who a stored credential belongs to.
 *   shared — one credential per service for the whole team; any active member may use it.
 *            Only admins can create or revoke one.
 *   user   — a member's own credential. Overrides the shared one for that member.
 * Resolution always prefers `user` over `shared` — see resolveCredential().
 */
const SCOPE_LEVELS = { SHARED: 'shared', USER: 'user' };

/* ------------------------------------------------------------------ data centres */

/**
 * DC profiles, from config.json `profiles`. `domains` are per-service API hosts; `{dc}` in a
 * service's host template is substituted with `dc_domain`.
 */
const PROFILES = {
  in: { dc_domain: 'in', accounts_domain: 'accounts.zoho.in', appid: '40000000224', service: 'logs360cloud', timezone: 'Asia/Kolkata',
        domains: { logs: 'logs.zoho.in', cliq: 'cliq.zoho.in', projects: 'projectsapi.zoho.in', learn: 'learn.zoho.in', writer: 'www.zohoapis.in', sheet: 'sheet.zoho.in', workdrive: 'workdrive.zoho.in' } },
  eu: { dc_domain: 'eu', accounts_domain: 'accounts.zoho.eu', appid: '20000100719', service: 'logs360cloud', timezone: 'Europe/Berlin',
        domains: { logs: 'logs.zoho.eu', cliq: 'cliq.zoho.eu', projects: 'projectsapi.zoho.eu', learn: 'learn.zoho.eu', writer: 'www.zohoapis.eu', sheet: 'sheet.zoho.eu', workdrive: 'workdrive.zoho.eu' } },
  us: { dc_domain: 'com', accounts_domain: 'accounts.zoho.com', appid: '36064526', service: 'logs360cloud', timezone: 'Asia/Kolkata',
        domains: { logs: 'logs.zoho.com', cliq: 'cliq.zoho.com', projects: 'projectsapi.zoho.com', learn: 'learn.zoho.com', writer: 'www.zohoapis.com', sheet: 'sheet.zoho.com', workdrive: 'workdrive.zoho.com' } },
  ae: { dc_domain: 'ae', accounts_domain: 'accounts.zoho.ae', appid: '170000003108', service: 'logs360cloud', timezone: 'Asia/Dubai',
        domains: { logs: 'logs.zoho.ae', cliq: 'cliq.zoho.ae', projects: 'projectsapi.zoho.ae', learn: 'learn.zoho.ae', writer: 'www.zohoapis.ae', sheet: 'sheet.zoho.ae', workdrive: 'workdrive.zoho.ae' } },
  uk: { dc_domain: 'uk', accounts_domain: 'accounts.zoho.uk', appid: '130000001527', service: 'logs360cloud', timezone: 'Europe/London',
        domains: { logs: 'logs.zoho.uk', cliq: 'cliq.zoho.uk', projects: 'projectsapi.zoho.uk', learn: 'learn.zoho.uk', writer: 'www.zohoapis.uk', sheet: 'sheet.zoho.uk', workdrive: 'workdrive.zoho.uk' } },
  jp: { dc_domain: 'jp', accounts_domain: 'accounts.zoho.jp', appid: '90000002103', service: 'logs360cloud', timezone: 'Asia/Tokyo',
        domains: { logs: 'logs.zoho.jp', cliq: 'cliq.zoho.jp', projects: 'projectsapi.zoho.jp', learn: 'learn.zoho.jp', writer: 'www.zohoapis.jp', sheet: 'sheet.zoho.jp', workdrive: 'workdrive.zoho.jp' } },
  au: { dc_domain: 'com.au', accounts_domain: 'accounts.zoho.com.au', appid: '7000001008', service: 'logs360cloud', timezone: 'Australia/Sydney',
        domains: { logs: 'logs.zoho.com.au', cliq: 'cliq.zoho.com.au', projects: 'projectsapi.zoho.com.au', learn: 'learn.zoho.com.au', writer: 'www.zohoapis.com.au', sheet: 'sheet.zoho.com.au', workdrive: 'workdrive.zoho.com.au' } },
  ca: { dc_domain: 'ca', accounts_domain: 'accounts.zohocloud.ca', appid: '110000003102', service: 'logs360cloud', timezone: 'America/Toronto',
        domains: { logs: 'logs.zohocloud.ca', cliq: 'cliq.zohocloud.ca', projects: 'projectsapi.zohocloud.ca', learn: 'learn.zohocloud.ca', writer: 'www.zohoapis.ca', sheet: 'sheet.zohocloud.ca', workdrive: 'workdrive.zohocloud.ca' } },
  localzoho: { dc_domain: 'localzoho', accounts_domain: 'accounts.localzoho.com', appid: '10772528', service: 'logs360cloud', timezone: 'Asia/Kolkata',
        domains: { logs: 'logs.localzoho.com', cliq: 'cliq.localzoho.com', projects: 'projectsapi.localzoho.com', learn: 'learn.localzoho.com', writer: 'www.zohoapis.localzoho.com', sheet: 'sheet.localzoho.com', workdrive: 'workdrive.localzoho.com' } },
  // Hacksaw lives on the ZohoCorp internal cloud, which has its own accounts host.
  zcc: { dc_domain: 'zohocorpcloud.in', accounts_domain: 'accounts.zohocorpcloud.in', appid: '', service: '', timezone: 'Asia/Kolkata',
        domains: { hacksaw: 'hacksaw.zohocorpcloud.in' } },
};

/* ------------------------------------------------------------------ services */

/**
 * The 11 connections. `scopes` are exactly the grants the kit found necessary — several were
 * widened after 401s, so don't trim them without re-testing (see the kit's SCOPES-INVENTORY.md).
 *
 * host: a template resolved against the DC profile. `{dc}` → profile.dc_domain,
 *       `@<name>` → profile.domains[name]. A literal host is used as-is.
 * redirect_port: retained from the kit's localhost OAuth listener. Irrelevant to the hosted flow
 *       (Catalyst supplies the redirect URI) but kept so the two setups stay comparable.
 */
const SERVICES = [
  {
    key: 'zoho-logs', label: 'Zoho Logs', auth_type: AUTH_TYPES.OAUTH,
    host: '@logs', default_dc: 'in', redirect_port: 8484,
    description: 'Log search and drill-down for Log360 Cloud.',
    scopes: ['ZohoLogs.Logs.READ'],
  },
  {
    key: 'zoho-cliq', label: 'Zoho Cliq', auth_type: AUTH_TYPES.OAUTH,
    host: '@cliq', default_dc: 'in', redirect_port: 8485,
    description: 'Read messages and create webhooks for alerting.',
    scopes: ['ZohoCliq.Messages.READ', 'ZohoCliq.Webhooks.CREATE'],
  },
  {
    key: 'zoho-projects', label: 'Zoho Projects', auth_type: AUTH_TYPES.OAUTH,
    host: '@projects', default_dc: 'in', redirect_port: 8486,
    description: 'Portals, projects, tasks, bugs, comments and attachments.',
    scopes: [
      'ZohoProjects.portals.READ', 'ZohoProjects.projects.ALL', 'ZohoProjects.tasks.ALL',
      'ZohoProjects.tasklists.ALL', 'ZohoProjects.bugs.READ', 'ZohoProjects.custom_fields.READ',
      'ZohoProjects.comments.ALL', 'ZohoProjects.attachments.ALL', 'ZohoProjects.documents.ALL',
      'ZohoProjects.users.READ',
    ],
  },
  {
    key: 'zoho-learn', label: 'Zoho Learn', auth_type: AUTH_TYPES.OAUTH,
    host: '@learn', default_dc: 'in', redirect_port: 8487,
    description: 'Knowledge base — spaces, manuals and articles.',
    scopes: ['ZohoLearn.network.READ', 'ZohoLearn.space.READ', 'ZohoLearn.space.CREATE',
             'ZohoLearn.manual.READ', 'ZohoLearn.article.READ'],
  },
  {
    key: 'zoho-writer', label: 'Zoho Writer', auth_type: AUTH_TYPES.OAUTH,
    host: '@writer', default_dc: 'in', redirect_port: 8488,
    description: 'Document editor API — fetch and export documents.',
    scopes: ['ZohoWriter.documentEditor.ALL'],
  },
  {
    key: 'zoho-sheet', label: 'Zoho Sheet', auth_type: AUTH_TYPES.OAUTH,
    host: '@sheet', default_dc: 'in', redirect_port: 8489,
    description: 'Spreadsheet data API — read records.',
    scopes: ['ZohoSheet.dataAPI.READ'],
  },
  {
    key: 'zoho-creator', label: 'Zoho Creator', auth_type: AUTH_TYPES.OAUTH,
    host: 'www.zohoapis.{dc}', default_dc: 'in', redirect_port: 8490,
    description: 'Reports, dashboards and app metadata. Meta endpoints need the full read set — ' +
                 'report.READ alone returns 401 code 2945.',
    scopes: ['ZohoCreator.report.READ', 'ZohoCreator.dashboard.READ', 'ZohoCreator.meta.form.READ',
             'ZohoCreator.meta.application.READ', 'ZohoCreator.bulk.READ'],
  },
  {
    key: 'zoho-workdrive', label: 'Zoho WorkDrive', auth_type: AUTH_TYPES.OAUTH,
    host: '@workdrive', default_dc: 'in', redirect_port: 8491,
    // WorkDrive's scope string is space-separated at the accounts endpoint, unlike the others.
    scope_separator: ' ',
    description: 'Team folders, files, links, labels, libraries and workflows.',
    scopes: [
      'WorkDrive.team.READ', 'WorkDrive.teamfolders.READ', 'WorkDrive.teamfolders.sharing.READ',
      'WorkDrive.teamfolders.admin.READ', 'WorkDrive.groups.READ', 'WorkDrive.files.READ',
      'WorkDrive.links.READ', 'WorkDrive.comments.READ', 'WorkDrive.collection.READ',
      'WorkDrive.datatemplates.READ', 'WorkDrive.labels.READ', 'WorkDrive.libraries.READ',
      'WorkDrive.libraries.sharing.READ', 'WorkDrive.libraries.categories.READ',
      'ZohoSearch.securesearch.READ', 'WorkDrive.workflows.READ', 'WorkDrive.workflowinstances.READ',
    ],
  },
  {
    key: 'zoho-hacksaw', label: 'Zoho Hacksaw', auth_type: AUTH_TYPES.OAUTH,
    host: '@hacksaw', default_dc: 'zcc', redirect_port: 8492,
    description: 'Security findings — organisations, products, reports and suppression rules.',
    scopes: ['Hacksaw.ORGANISATION.READ', 'Hacksaw.PRODUCT.READ', 'Hacksaw.REPORT.READ',
             'Hacksaw.PRODUCTTAG.READ', 'Hacksaw.ORG_SUPPRESSION_RULE.READ',
             'Hacksaw.PRODUCT_SUPPRESSION_RULE.READ'],
  },
  {
    key: 'zoho-cmtools', label: 'CMTools (build automation)', auth_type: AUTH_TYPES.PRIVATE_TOKEN,
    host: 'build.zohocorp.com', default_dc: 'csez', redirect_port: null,
    auth_header: 'PRIVATE-TOKEN', auth_header_format: '{token}',
    description: 'Build automation API. Not OAuth — a static PRIVATE-TOKEN header. ' +
                 'zohocorp.com accounts only.',
    scopes: [],
  },
  {
    key: 'zoho-repository', label: 'Zoho Repository', auth_type: AUTH_TYPES.PAT,
    host: 'api.repository.zoho.in', default_dc: 'in', redirect_port: null,
    auth_header: 'Authorization', auth_header_format: 'Zoho-zapikey {token}',
    description: 'Source repositories, groups and members. Personal access token.',
    scopes: [],
  },
];

/* ------------------------------------------------------------------ lookups */

const byKey = new Map(SERVICES.map(s => [s.key, s]));

function getService(key) {
  const s = byKey.get(String(key || '').toLowerCase());
  if (!s) throw new Error(`Unknown connection '${key}'`);
  return s;
}

function getProfile(dc) {
  const p = PROFILES[String(dc || '').toLowerCase()];
  if (!p) throw new Error(`Unknown data centre '${dc}'. Valid: ${Object.keys(PROFILES).join(', ')}`);
  return p;
}

/** The scope string as the accounts endpoint expects it (comma-separated, space for WorkDrive). */
function scopeString(service) {
  return service.scopes.join(service.scope_separator || ',');
}

/** Resolve a service's API host for a data centre. */
function apiHost(service, dc) {
  const host = service.host;
  if (host.startsWith('@')) {
    const profile = getProfile(dc);
    const resolved = profile.domains[host.slice(1)];
    if (!resolved) {
      throw new Error(`'${service.key}' has no host in data centre '${dc}'`);
    }
    return resolved;
  }
  if (host.includes('{dc}')) return host.replace('{dc}', getProfile(dc).dc_domain);
  return host; // literal
}

/** Which data centres this service can actually be used in. */
function availableDcs(service) {
  if (!service.host.startsWith('@')) return [service.default_dc];
  const name = service.host.slice(1);
  return Object.keys(PROFILES).filter(dc => PROFILES[dc].domains[name]);
}

/** Catalogue view for the UI — definitions only, no credential state. */
function publicCatalogue() {
  return SERVICES.map(s => ({
    key: s.key,
    label: s.label,
    auth_type: s.auth_type,
    description: s.description,
    scopes: s.scopes,
    scope_count: s.scopes.length,
    default_dc: s.default_dc,
    available_dcs: availableDcs(s),
    redirect_port: s.redirect_port,
  }));
}

module.exports = {
  AUTH_TYPES, SCOPE_LEVELS, PROFILES, SERVICES,
  getService, getProfile, scopeString, apiHost, availableDcs, publicCatalogue,
};
