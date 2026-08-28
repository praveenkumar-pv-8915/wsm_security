import { Fragment, useState } from 'react';
import { api } from '../lib/api';

/**
 * Ask — first slice of compliancemanager's query_handler in the Welcome app.
 *
 * Read-only. Answers a small set of demo questions with citations (see ask-service.js); anything
 * else gets an honest "not grounded yet" message rather than a fabricated answer, since the real
 * LLM grounding path isn't wired up (claude/compliancemanager-integration-design.md).
 */

const EXAMPLES = [
  'Which ISO standards do our registers cover?',
  'What open risks are flagged critical right now?',
  'Which modules are missing from the RACI matrix?',
];

export default function Ask() {
  const [question, setQuestion] = useState('');
  const [history, setHistory] = useState([]);
  const [answer, setAnswer] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const ask = async (q) => {
    const text = (q ?? question).trim();
    if (!text) return;
    setBusy(true);
    setError('');
    try {
      const r = await api('/ask', { method: 'POST', body: { question: text } });
      setAnswer(r);
      setQuestion(text);
      setHistory((h) => [text, ...h.filter((x) => x !== text)]);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="view-head">
        <div>
          <h2 className="view-title">Ask</h2>
          <p className="view-sub">A compliance question, answered with citations from the product package and latest snapshots.</p>
        </div>
      </div>

      <div className="ask-layout">
        <div className="ask-main">
          <section className="card">
            <div className="ask-row">
              <input
                type="text"
                placeholder="e.g. Which ISO standards do our registers cover?"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && ask()}
              />
              <button className="btn btn-primary" onClick={() => ask()} disabled={busy}>Ask</button>
            </div>
            <div className="ask-chips">
              {EXAMPLES.map((q) => (
                <button key={q} className="tag tag-muted ask-chip" onClick={() => ask(q)}>{q}</button>
              ))}
            </div>
          </section>

          <section className="card card-muted">
            <div className="card-head"><h2>Recent questions</h2></div>
            {history.length
              ? <ul className="ask-history">{history.map((q) => (
                  <li key={q}><button className="ask-chip-inline" onClick={() => ask(q)}>{q}</button></li>
                ))}</ul>
              : <p className="empty">Nothing asked yet this session.</p>}
          </section>
        </div>

        <div className="ask-side">
          <section className="card">
            <div className="card-head"><h2>Answer</h2></div>
            {error && <div className="banner banner-err" role="status">{error}</div>}
            {!error && !answer && (
              <p className="hint">Ask a question, or pick one of the examples — the answer and its citations appear here.</p>
            )}
            {!error && answer && (
              <>
                <p className="dim">{answer.question}</p>
                <p style={{ marginTop: 8 }}>{answer.answer}</p>
                {answer.citations?.length > 0 && (
                  <>
                    <div className="sec-title" style={{ marginTop: 14 }}>Citations</div>
                    <ol className="ask-citations">
                      {answer.citations.map((c) => <li key={c}>{c}</li>)}
                    </ol>
                  </>
                )}
              </>
            )}
          </section>

          <section className="card card-muted">
            <div className="card-head"><h2>Grounded in</h2></div>
            <dl className="kv">
              {(answer?.sources || [['Product package', 'log360-cloud'], ['Guidelines', 'RISK_GUIDELINES.md']]).map(([k, v]) => (
                <Fragment key={k}><dt>{k}</dt><dd>{v}</dd></Fragment>
              ))}
            </dl>
          </section>

          <section className="card card-muted">
            <div className="card-head"><h2>About</h2></div>
            <p className="hint">Read-only. Answers are grounded in the active product's data — no write actions happen from here.</p>
          </section>
        </div>
      </div>
    </>
  );
}
