/**
 * Renders risk-guidelines.md in a readable, formatted way for the "View guidelines" modal —
 * replacing the old raw `<pre>` text dump (2026-09-01 rework, requested: reorder rules, make the
 * doc itself clearer, and render it legibly in the UI).
 *
 * This is a small hand-rolled parser for the specific markdown subset risk-guidelines.md actually
 * uses (headings, a legend table, blockquote intro, bold/italic/code/links, bullet lists) rather
 * than pulling in a markdown dependency for one read-only reference panel. Rule bullets
 * ("**G6 [Z][S]** — ...") get their own layout: the rule ID and its [tag] badges are pulled out of
 * the text and rendered as small pills (colored by what each tag means — see TAG_INFO) ahead of
 * the description, instead of showing the literal brackets inline.
 */

const TAG_INFO = {
  Z: { label: 'Z', title: 'From the official Zoho guideline article', kind: 'origin' },
  T: { label: 'T', title: 'Tool-added review convention', kind: 'origin' },
  U: { label: 'U', title: 'Mandated by the Log360 Cloud compliance owner', kind: 'origin' },
  S: { label: 'S', title: 'Enforced deterministically by script', kind: 'scripted' },
  P: { label: 'P', title: 'Judged by an LLM (prose review)', kind: 'llm' },
};

/** "[Z/U][P]" / "[S — ISMS]" / "[S/P]" → [{label, title, kind, note?}] */
function parseTags(raw) {
  const brackets = [...raw.matchAll(/\[([^\]]+)\]/g)].map((m) => m[1]);
  const out = [];
  for (const b of brackets) {
    const [codes, ...noteParts] = b.split(/\s*—\s*/);
    const note = noteParts.join(' — ') || undefined;
    for (const code of codes.split('/')) {
      const info = TAG_INFO[code];
      if (info) out.push({ ...info, note });
    }
  }
  return out;
}

function TagPill({ tag }) {
  return (
    <span className={`gl-tag gl-tag-${tag.kind}`} title={tag.note ? `${tag.title} (${tag.note})` : tag.title}>
      {tag.label}
    </span>
  );
}

/** Inline formatting: **bold**, `code`, [text](url) — plain string in, array of nodes out. */
function renderInline(text, keyPrefix) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g);
  return parts.filter(Boolean).map((part, i) => {
    const key = `${keyPrefix}-${i}`;
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={key}>{part.slice(2, -2)}</strong>;
    if (part.startsWith('`') && part.endsWith('`')) return <code key={key} className="gl-code">{part.slice(1, -1)}</code>;
    const link = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (link) return <a key={key} href={link[2]} target="_blank" rel="noreferrer">{link[1]}</a>;
    return <span key={key}>{part}</span>;
  });
}

/** One `- **G6 [Z][S]** — description` bullet, or a plain bullet with no rule-ID prefix. */
function RuleItem({ text, itemKey }) {
  const m = text.match(/^\*\*([A-Za-z0-9]+)\s+((?:\[[^\]]+\])+)\*\*\s*—\s*(.*)$/s);
  if (!m) {
    return <li key={itemKey} className="gl-li">{renderInline(text, itemKey)}</li>;
  }
  const [, ruleId, tagBlock, rest] = m;
  const tags = parseTags(tagBlock);
  return (
    <li key={itemKey} className="gl-rule">
      <div className="gl-rule-head">
        <span className="gl-rule-id">{ruleId}</span>
        {tags.map((t, i) => <TagPill key={i} tag={t} />)}
      </div>
      <div className="gl-rule-body">{renderInline(rest, itemKey)}</div>
    </li>
  );
}

/** Splits the doc into blank-line-separated chunks, classifies each, and renders it. */
export default function GuidelinesView({ text }) {
  const chunks = text.split(/\n{2,}/).map((c) => c.trimEnd()).filter(Boolean);
  const nodes = [];
  let listBuf = null;
  let listKey = 0;

  const flushList = () => {
    if (listBuf) {
      nodes.push(<ul key={`ul-${listKey++}`} className="gl-list">{listBuf}</ul>);
      listBuf = null;
    }
  };

  chunks.forEach((chunk, ci) => {
    const lines = chunk.split('\n');
    const first = lines[0];

    if (/^#{1,6}\s/.test(first)) {
      flushList();
      const level = first.match(/^#+/)[0].length;
      const content = chunk.replace(/^#{1,6}\s*/, '');
      const Tag = level <= 2 ? 'h3' : 'h4';
      nodes.push(<Tag key={`h-${ci}`} className={`gl-h gl-h${level}`}>{renderInline(content, `h-${ci}`)}</Tag>);
      return;
    }

    if (lines.every((l) => l.startsWith('>'))) {
      flushList();
      const inner = lines.map((l) => l.replace(/^>\s?/, '')).join(' ');
      nodes.push(<blockquote key={`bq-${ci}`} className="gl-quote">{renderInline(inner, `bq-${ci}`)}</blockquote>);
      return;
    }

    if (lines[0].startsWith('|')) {
      flushList();
      const rows = lines.filter((l) => l.trim() && !/^\|[\s-:|]+\|$/.test(l.trim()))
        .map((l) => l.replace(/^\||\|$/g, '').split('|').map((c) => c.trim()));
      const [header, ...body] = rows;
      nodes.push(
        <table key={`tbl-${ci}`} className="gl-table">
          <thead><tr>{header.map((h, i) => <th key={i}>{renderInline(h, `th-${ci}-${i}`)}</th>)}</tr></thead>
          <tbody>
            {body.map((r, ri) => (
              <tr key={ri}>{r.map((c, ci2) => <td key={ci2}>{renderInline(c, `td-${ci}-${ri}-${ci2}`)}</td>)}</tr>
            ))}
          </tbody>
        </table>
      );
      return;
    }

    if (/^-\s/.test(first)) {
      // Join each bullet's own continuation lines (indented, no leading "- ") into one item.
      const items = [];
      for (const line of lines) {
        if (/^-\s/.test(line)) items.push(line.replace(/^-\s/, ''));
        else if (items.length) items[items.length - 1] += ' ' + line.trim();
      }
      const li = items.map((item, ii) => <RuleItem key={ii} itemKey={`li-${ci}-${ii}`} text={item} />);
      listBuf = listBuf ? [...listBuf, ...li] : li;
      return;
    }

    flushList();
    nodes.push(<p key={`p-${ci}`} className="gl-p">{renderInline(lines.join(' '), `p-${ci}`)}</p>);
  });
  flushList();

  return <div className="gl-doc">{nodes}</div>;
}
