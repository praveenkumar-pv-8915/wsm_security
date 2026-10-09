import { useCallback, useEffect, useState } from 'react';
import {
  ALLOWED_DOMAIN,
  APP_PATH,
  SESSION,
  normaliseUser,
  readCurrentUser,
  signOut,
  startHostedSignIn,
} from '../lib/catalyst';
import { AUTH_LOST_EVENT } from '../lib/api';

/**
 * Gate in front of the whole app. Nothing renders until Catalyst says there is a session.
 *
 * This project uses Catalyst **hosted** auth, so signing in is a redirect to Catalyst's own login
 * page — there is no embedded widget and no iframe div to mount. (The embedded flow is what used to
 * render an empty white box here: embedded auth is off for this project and the iframe was asked
 * for providers-only chrome with no providers enabled.)
 *
 * States:
 *   loading        — the session check is in flight
 *   sign-in        — no session; offers the hosted login redirect
 *   denied         — signed in, but not an ALLOWED_DOMAIN account; auto signs out
 *   not-authorized — a valid Zoho session that isn't a user of this Catalyst project
 *   sdk-error      — the session check itself failed
 *   ok             — renders children(user)
 *
 * The domain check here is UX, not security. It stops someone with a personal Zoho account from
 * reaching a UI that would only 403 anyway. functions/welcome/auth.js runs the same check
 * server-side on every request, and that is the one that counts — this component can be bypassed
 * by anyone with devtools, and bypassing it buys nothing.
 *
 * On a failed user read the gate goes to sdk-error rather than falling through, so a Catalyst API
 * hiccup can never be the reason the domain check gets skipped.
 */
export default function AuthGate({ children }) {
  const [state, setState] = useState('loading');
  const [user, setUser] = useState(null);
  const [error, setError] = useState('');

  const check = useCallback(async () => {
    setState('loading');

    const { status, record, error: readError } = await readCurrentUser();

    if (status === SESSION.ANONYMOUS) {
      setState('sign-in');
      return;
    }

    if (status === SESSION.NOT_AUTHORIZED) {
      setError('Your Zoho account is signed in but has not been added to this Catalyst project.');
      setState('not-authorized');
      return;
    }

    if (status !== SESSION.OK) {
      setError(readError || 'The session check failed.');
      setState('sdk-error');
      return;
    }

    const nextUser = normaliseUser(record);
    if (!nextUser.email.endsWith(ALLOWED_DOMAIN)) {
      setError(`Access is restricted to ${ALLOWED_DOMAIN} accounts.`);
      setState('denied');
      setTimeout(() => signOut(APP_PATH), 1800);
      return;
    }

    setUser(nextUser);
    setState('ok');
  }, []);

  useEffect(() => {
    check();
  }, [check]);

  // A 401 from any api() call anywhere in the tree drops us back to the sign-in screen instead of
  // leaving a dead UI showing stale data behind an expired session.
  useEffect(() => {
    const onAuthLost = () => {
      setUser(null);
      setError('');
      setState('sign-in');
    };
    window.addEventListener(AUTH_LOST_EVENT, onAuthLost);
    return () => window.removeEventListener(AUTH_LOST_EVENT, onAuthLost);
  }, []);

  if (state === 'ok') return children(user);

  return (
    <div className="gate">
      <div className="gate-card">
        <div className="gate-brand">
          <span className="vault-glyph" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3l7 3v6c0 4.5-3 8-7 9-4-1-7-4.5-7-9V6l7-3z" />
              <path d="M9.5 12.5l1.8 1.8 3.2-3.6" />
            </svg>
          </span>
          <div>
            <h1>WSM Security</h1>
            <p className="vault-sub">Team workspace · Zoho Catalyst</p>
          </div>
        </div>

        {state === 'loading' && <p className="gate-msg">Checking your session…</p>}

        {state === 'sign-in' && (
          <>
            <p className="gate-msg">Internal tool — {ALLOWED_DOMAIN} accounts only.</p>
            <div className="gate-signin">
              <button className="btn btn-primary" type="button" onClick={() => startHostedSignIn()}>
                Sign in with Zoho
              </button>
            </div>
          </>
        )}

        {state === 'denied' && (
          <>
            <p className="gate-msg gate-msg-err">{error}</p>
            <p className="gate-msg">Signing you out…</p>
          </>
        )}

        {state === 'not-authorized' && (
          <>
            <h2 className="gate-title">Not authorised</h2>
            <p className="gate-msg gate-msg-err">{error}</p>
            <p className="gate-msg">Ask a WSM Security admin to add you in Catalyst Console → Users.</p>
            <div className="gate-signin">
              <button className="btn btn-ghost" type="button" onClick={() => signOut(APP_PATH)}>
                Sign out
              </button>
            </div>
          </>
        )}

        {state === 'sdk-error' && (
          <>
            <h2 className="gate-title">Sign-in unavailable</h2>
            <p className="gate-msg gate-msg-err">{error}</p>
            <div className="gate-signin">
              <button className="btn btn-ghost" type="button" onClick={check}>
                Retry
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
