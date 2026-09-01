/**
 * DPIA risk-table extractor — JS port of compliancemanager's risk_manager/dpia_parser.py.
 *
 * Works on a DPIA Zoho Writer document's HTML export (table structure survives; the txt export
 * flattens cells). A risk table is any table whose header row contains at least 'threat', 'risk',
 * and 'control'. Falls back to a positional read of a headerless table sitting right under a
 * "RISK AND CONTROL" / "THREATS AND RISKS" heading (Writer sometimes splits one logical table into
 * several table elements, one per row). DPIAs that state "No new threats" yield an empty list.
 */

const HEADER_KEYS = {
  's.no': 'sno', 'sno': 'sno', 's no': 'sno',
  'threat': 'threat',
  'vulnerability': 'vulnerability',
  'risk': 'risk',
  'control': 'control',
  'residual risk': 'residual_risk',
};

const POSITIONAL = {
  4: ['sno', 'threat', 'vulnerability', 'control'],
  5: ['sno', 'threat', 'vulnerability', 'risk', 'control'],
  6: ['sno', 'threat', 'vulnerability', 'risk', 'control', 'residual_risk'],
};

const SECTION_RE = /(RISK AND CONTROL|THREATS?\s*(&|AND)\s*RISKS?)\s*$/i;

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decodeEntities(str) {
  return String(str).replace(/&(#\d+|#x[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, code) => {
    if (code[0] === '#') {
      const cp = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isNaN(cp) ? m : String.fromCodePoint(cp);
    }
    return Object.prototype.hasOwnProperty.call(ENTITIES, code) ? ENTITIES[code] : m;
  });
}

const collapseWs = s => s.replace(/\s+/g, ' ');

/**
 * Minimal streaming tag/text tokenizer, tracking table/tr/td/th nesting the same way Python's
 * html.parser.HTMLParser callbacks do in the source tool. Not a general HTML parser — just enough
 * to recover table structure and the plain text immediately preceding each table.
 */
function collectTables(html) {
  const tables = [];
  const preceding = [];
  const tableStack = [];
  const preStack = [];
  let row = null;
  let cell = null;
  const textBuf = [];

  const tokenRe = /<\/?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>|[^<]+/g;
  let m;
  // eslint-disable-next-line no-cond-assign
  while ((m = tokenRe.exec(html)) !== null) {
    const token = m[0];
    if (token[0] === '<') {
      const closing = token[1] === '/';
      const tag = (m[1] || '').toLowerCase();
      if (!closing) {
        if (tag === 'table') {
          const tail = collapseWs(textBuf.join('')).slice(-200);
          tableStack.push([]);
          preStack.push(tail);
        } else if (tag === 'tr' && tableStack.length) {
          row = [];
        } else if ((tag === 'td' || tag === 'th') && row !== null) {
          cell = [];
        }
      } else if (tag === 'table' && tableStack.length) {
        tables.push(tableStack.pop());
        preceding.push(preStack.pop());
      } else if (tag === 'tr' && row !== null) {
        if (tableStack.length) tableStack[tableStack.length - 1].push(row);
        row = null;
      } else if ((tag === 'td' || tag === 'th') && cell !== null) {
        const text = collapseWs(cell.join(' ')).trim();
        if (row !== null) row.push(text);
        cell = null;
      }
    } else {
      const data = decodeEntities(token);
      if (cell !== null) cell.push(data);
      else if (!tableStack.length) textBuf.push(data);
    }
  }
  return { tables, preceding };
}

function normalizeHeader(cell) {
  const key = collapseWs(cell).replace(/^[.\s]+|[.\s]+$/g, '').toLowerCase();
  return Object.prototype.hasOwnProperty.call(HEADER_KEYS, key) ? HEADER_KEYS[key] : null;
}

function rowsFromNamedTable(table) {
  const header = table[0].map(normalizeHeader);
  const named = header.filter(Boolean);
  if (!named.includes('threat') || !named.includes('risk') || !named.includes('control')) return null;
  const rows = [];
  for (const raw of table.slice(1)) {
    const row = {};
    header.forEach((h, i) => { if (h && i < raw.length) row[h] = raw[i].trim(); });
    if (Object.entries(row).some(([k, v]) => k !== 'sno' && v)) rows.push(row);
  }
  return rows;
}

function rowsFromPositionalTable(table) {
  const rows = [];
  for (const raw of table) {
    const cells = raw.map(c => c.trim());
    const names = POSITIONAL[cells.length];
    if (!names || !/^\d+$/.test(cells[0] || '')) continue;
    const row = {};
    names.forEach((n, i) => { row[n] = cells[i]; });
    if (Object.entries(row).some(([k, v]) => k !== 'sno' && v)) rows.push(row);
  }
  return rows;
}

/** HTML string -> [{sno, threat, vulnerability, risk, control, residual_risk}, ...] */
function extractRiskRows(html) {
  const { tables, preceding } = collectTables(String(html || ''));

  // Pass 1: a table that names its columns (Threat / Risk / Control ...).
  for (const table of tables) {
    if (table.length) {
      const rows = rowsFromNamedTable(table);
      if (rows !== null) return rows;
    }
  }

  // Pass 2: headerless table(s) directly under a RISK/THREATS section heading, columns by
  // position — accumulate across all tables under the same heading.
  const rows = [];
  tables.forEach((table, i) => {
    if (table.length && SECTION_RE.test((preceding[i] || '').trim())) {
      rows.push(...rowsFromPositionalTable(table));
    }
  });
  return rows;
}

module.exports = { extractRiskRows };
