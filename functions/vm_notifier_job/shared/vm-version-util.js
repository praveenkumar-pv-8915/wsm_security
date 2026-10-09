/* GENERATED COPY — do not edit.
 * Source: functions/welcome/vm-version-util.js
 * Regenerate: node scripts/sync-job-modules.js   (npm run sync:job)
 * Why: Catalyst packages each function directory separately, so the job function cannot require
 * across into functions/welcome at runtime. See functions/vm_notifier_job/index.js.
 */
/**
 * Version parsing, comparison and release-note summarising for the Dependency Upgrade Notifier.
 *
 * A port of `agent-knowledge-kit/src/vm_management/lib/core.py` (the parts that are pure functions)
 * plus the text-slicing helpers from its `lib/sources.py`. Ported rather than reinvented: those
 * regexes were tuned against eight real dependencies' release notes over months, and the failure
 * mode of getting them subtly wrong is silence — a version that never notifies, or a jar version
 * stored as a release.
 *
 * Everything here is deliberately pure and dependency-free, so the scan engine stays testable
 * without DataStore or a live connection.
 *
 * ── The two version schemes ──────────────────────────────────────────────────────────────────
 * Dotted (`9.0.21`) and M2-style (`M2_38_10`). Comparison treats both as a tuple of the integers
 * in the string, so `M2_38_10` and `2.38.10` compare identically; only the *display* form differs,
 * which is what `normalizeVersion` and `formatSeriesLabel` preserve.
 */

'use strict';

/* ------------------------------------------------------------------ comparison */

/** Every integer in the string, in order. `M2_38_10` → [2, 38, 10]. */
function parseDotted(version) {
  if (!version) return [];
  return (String(version).match(/\d+/g) || []).map(Number);
}

/** -1 / 0 / 1, comparing the integer tuples zero-padded to equal length. */
function versionCmp(left, right) {
  const a = parseDotted(left);
  const b = parseDotted(right);
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i += 1) {
    const x = a[i] || 0;
    const y = b[i] || 0;
    if (x !== y) return x > y ? 1 : -1;
  }
  return 0;
}

/** True when `candidate` is strictly newer. No baseline means anything is newer. */
function isNewer(candidate, baseline) {
  if (!candidate) return false;
  if (!baseline) return true;
  return versionCmp(candidate, baseline) > 0;
}

/** Canonical display form: `M2.38.10` → `M2_38_10`; dotted versions are left alone. */
function normalizeVersion(version) {
  if (!version) return version;
  const text = String(version).trim();
  const m2 = /^M(\d+)[._-](\d+)[._-](\d+)$/i.exec(text);
  return m2 ? `M${m2[1]}_${m2[2]}_${m2[3]}` : text;
}

/** Family + series, for deps that maintain several lines at once. `9.0.21` → `9.0`. */
function seriesKey(version) {
  const parts = parseDotted(version);
  return parts.length < 2 ? null : parts.slice(0, 2);
}

/** `M2_38_11` → `M2_38`; `9.0.21` → `9.0`. */
function formatSeriesLabel(version, scheme) {
  const parts = parseDotted(version);
  if (parts.length < 2) return version || '';
  const text = String(version || '');
  if (scheme === 'm2' || text.toUpperCase().startsWith('M')) return `M${parts[0]}_${parts[1]}`;
  return `${parts[0]}.${parts[1]}`;
}

/** Series `left` is the same as or newer than `right`. */
function seriesGte(left, right) {
  const n = Math.max(left.length, right.length);
  for (let i = 0; i < n; i += 1) {
    const x = left[i] || 0;
    const y = right[i] || 0;
    if (x !== y) return x > y;
  }
  return true;
}

/**
 * Is this version still in scope, given what we already consider current?
 *
 * For a `series` dependency, a version in an OLDER series is out of scope but one in the current or
 * a newer series is not — LogAgentClient maintains 8.x and 9.x in parallel, so an 8.0.4 published
 * after 9.0.1 is a real release for whoever is on 8.x and must not be swallowed by a max-only
 * check. For everything else, newer-than-current is the whole test.
 */
function inScope(version, current, { series = false } = {}) {
  if (!version) return false;
  if (!series) return isNewer(version, current);
  if (!current) return true;
  const key = seriesKey(version);
  const floor = seriesKey(current);
  if (!key || !floor) return isNewer(version, current);
  if (!seriesGte(key, floor)) return false;
  // Within the current series the version still has to be newer; a newer series always qualifies.
  return seriesGte(key, floor) && (versionCmp(key, floor) > 0 || isNewer(version, current));
}

/* ------------------------------------------------------------------ pattern compilation */

/**
 * Compile a version pattern that may carry Python-style inline flags.
 *
 * The patterns in use come from the Python tool's config.json, where two of the eight start with
 * `(?i)` — inline flag syntax Python supports and JavaScript does not: `new RegExp('(?i)(M2...)')`
 * throws "Invalid group". Left unhandled, pasting `(?i)(M2[._-]\d+[._-]\d+)` into the form would
 * be rejected as a broken regex, and the two M2 dependencies could not be watched at all.
 *
 * So a leading inline-flag group is lifted into real JS flags instead. Only `i`, `m` and `s` are
 * translated, because those are the only ones with a JS equivalent; anything else in the group is
 * dropped rather than failing the whole pattern (Python's `x`/verbose mode has no JS counterpart,
 * and none of the real patterns use it).
 *
 * Returns null when the pattern cannot be compiled at all, so every caller degrades to "no match"
 * rather than throwing mid-scan.
 */
function compilePattern(pattern, extraFlags = '') {
  if (!pattern) return null;
  let source = String(pattern);
  let flags = extraFlags;
  const inline = /^\(\?([a-zA-Z]+)\)/.exec(source);
  if (inline) {
    source = source.slice(inline[0].length);
    for (const flag of inline[1].toLowerCase()) {
      if ('ims'.includes(flag) && !flags.includes(flag)) flags += flag;
    }
  }
  try {
    return new RegExp(source, flags);
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ extraction */

/** First match of `pattern` in `text`, preferring the first non-empty capture group. */
function matchVersion(match) {
  if (!match) return null;
  for (let i = 1; i < match.length; i += 1) {
    if (match[i]) return normalizeVersion(String(match[i]).trim());
  }
  return normalizeVersion(String(match[0]).trim());
}

/** One version out of a title or body. Returns null when the pattern does not hit. */
function extractVersion(text, pattern) {
  if (!text || !pattern) return null;
  const re = compilePattern(pattern);
  return re ? matchVersion(re.exec(String(text))) : null;
}

/** Every distinct version in the text, in document order — a Learn page lists many. */
function versionsInText(text, pattern) {
  const out = [];
  if (!pattern) return out;
  const re = compilePattern(pattern, 'gim');
  if (!re) return out;
  const seen = new Set();
  let match = re.exec(String(text || ''));
  while (match) {
    const version = matchVersion(match);
    if (version && !seen.has(version)) {
      seen.add(version);
      out.push(version);
    }
    // A zero-width match would spin forever on a pattern made entirely of optional groups.
    if (match.index === re.lastIndex) re.lastIndex += 1;
    match = re.exec(String(text || ''));
  }
  return out;
}

const escapeRe = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Slice a multi-version notes page down to the block belonging to one version.
 *
 * A Learn release-notes article is one page listing every version ever shipped; without this, every
 * notification would carry the entire history. Falls back to a plain index search, then to the
 * whole text, because a missed heading shape should degrade to "too much context" rather than
 * "no context".
 */
function extractVersionSection(text, version, pattern) {
  const body = String(text || '');
  if (!body) return '';
  if (!version) return body.slice(0, 4000);

  const heading = new RegExp(`^(?:#{1,6}\\s*)?(?:[A-Za-z][\\w.-]*\\s+)?${escapeRe(version)}\\b.*$`, 'm');
  const match = heading.exec(body);
  if (!match) {
    const idx = body.indexOf(version);
    if (idx < 0) return '';
    const rest = body.slice(idx);
    const nxt = /^\S.*(M\d+[._-]\d+[._-]\d+|\d+\.\d+)/m.exec(rest.slice(version.length));
    const end = nxt ? version.length + nxt.index : rest.length;
    return rest.slice(0, Math.min(end, 6000)).trim();
  }

  const start = match.index;
  const afterHeading = start + match[0].length;
  const tail = body.slice(afterHeading);
  const nextVer = /^(?:#{1,6}\s*)?(?:[A-Za-z][\w.-]*\s+)?(?:M\d+[._-]\d+[._-]\d+|\d+\.\d+(?:\.\d+)*)\b/m.exec(tail);
  const block = body.slice(start, afterHeading + (nextVer ? nextVer.index : tail.length));
  return block.slice(0, 8000).trim();
}

/* ------------------------------------------------------------------ text → summary */

function htmlToText(html) {
  if (!html) return '';
  return String(html)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/h[1-6]>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const MUST_DO_RE = /\b(cve-?\d|vulnerab|security\s+(fix|patch|update|advisory)|critical|breaking|must(\s+not)?\s+(upgrade|update|do|ignore)|mandatory|incompatible|migrat|deprecated|auth(entication|z)|certificate|openssl|tomcat|upgrade\s+required)\b/i;
const MAJOR_RE = /\b(major|new\s+feature|added\s+support|breaking|remap|bump|upgrad(e|ed)|compatib|default\s+chang)\b/i;
const INTERNAL_RE = /\[\s*internal\s*\]/i;
const URL_RE = /https?:\/\/\S+/gi;
const EMAIL_RE = /\b[\w.+-]+@[\w.-]+\.\w+\b/g;
const AUTHOR_TAG_RE = /\[[a-z0-9._-]+\]\s*/gi;
const BANNER_RE = /^(saslite[_\s]+\d|build\s*:|\*?\s*\d{1,2}\/\w+\/\d{4}|change notes:?$|\d+\.\d+(?:\.\d+)*$)/i;
const SEP_RE = /^[\-=_]{5,}$/;

/**
 * Strip member logins, emails and author tags before anything is stored or displayed.
 *
 * Carried over from the Python tool, and it matters more here: that tool wrote to a JSON file on
 * one laptop, whereas these summaries land in a DataStore table the whole team reads. `auth.js`
 * keeps PII out of every other table in this app; this keeps it out of release notes too.
 */
function redactPii(text) {
  if (!text) return '';
  return String(text).replace(EMAIL_RE, '').replace(AUTHOR_TAG_RE, '').replace(INTERNAL_RE, '');
}

function isBannerLine(line) {
  const text = String(line || '').trim();
  if (text.length < 8) return true;
  return SEP_RE.test(text) || BANNER_RE.test(text);
}

function cleanNoteLine(line) {
  return redactPii(String(line || '').replace(/<[^>]+>/g, '').replace(URL_RE, ''))
    .replace(/^\d+\.\s*/, '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s\-*\t]+|[\s\-*\t]+$/g, '');
}

/** Action-required bullets only — empty when there is nothing a developer must act on. */
function necessaryBullets(text, maxItems = 3) {
  if (!text) return [];
  const seen = new Set();
  const out = [];
  for (const raw of String(text).split(/[\r\n]+/)) {
    if (INTERNAL_RE.test(raw)) continue;
    let cleaned = cleanNoteLine(raw);
    if (isBannerLine(cleaned)) continue;
    const hit = MUST_DO_RE.test(raw) || MUST_DO_RE.test(cleaned)
      || MAJOR_RE.test(raw) || MAJOR_RE.test(cleaned);
    if (!hit) continue;
    if (cleaned.length > 140) cleaned = `${cleaned.slice(0, 137).trimEnd()}…`;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(cleaned);
    if (out.length >= maxItems) break;
  }
  return out;
}

const NO_ACTION = 'No action-required changes.';

/** The compact, PII-free summary that gets stored. Never the raw notes. */
function summarize(text) {
  const bullets = necessaryBullets(redactPii(text), 4);
  return bullets.length ? bullets.map(x => `- ${x}`).join('\n') : NO_ACTION;
}

/**
 * Clamp an excerpt for storage/display. 700 chars is the Python tool's own limit
 * (`notify.py::_clean`) — kept identical so one stored row stays comfortably inside the
 * 10,000-char DataStore `Text` cap even at its worst.
 */
function cleanExcerpt(text, limit = 700) {
  if (!text) return '';
  const cleaned = redactPii(String(text))
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return cleaned.length > limit ? `${cleaned.slice(0, limit).trimEnd()}…` : cleaned;
}

module.exports = {
  compilePattern, parseDotted, versionCmp, isNewer, normalizeVersion,
  seriesKey, formatSeriesLabel, seriesGte, inScope,
  extractVersion, versionsInText, extractVersionSection,
  htmlToText, redactPii, necessaryBullets, summarize, cleanExcerpt,
  NO_ACTION,
};
