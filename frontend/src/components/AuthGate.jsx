import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ALLOWED_DOMAIN,
  fetchCurrentUser,
  isSignedIn,
  normaliseUser,
  signOut,
  waitForCatalyst,
} from '../lib/catalyst';
import { AUTH_LOST_EVENT } from '../lib/api';

/**
 * Gate in front of the whole app. Nothing renders until Catalyst says there is a session.
 *
 * States:
 *   loading   — SDK still initialising, or the session check is in flight
 *   sign-in   — no session; the Catalyst sign-in widget is mounted here
 *   denied    — signed in, but not an ALLOWED_DOMAIN account; auto signs out
 *   sdk-error — the SDK never loaded, or the user record couldn't be read
 *   ok        — renders children(user)
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
  const signInMounted = useRef(false);

  const check = useCallback(async () => {
    try {
      const catalyst = await waitForCatalyst();

      if (!(await isSignedIn(catalyst))) {
        signInMounted.current = false;
        setState('sign-in');
        return;
      }

      const record = await fetchCurrentUser(catalyst);
      if (!record) {
        setError('Signed in, but Catalyst would not return your user record.');
        setState('sdk-error');
        return;
      }

      const nextUser = normaliseUser(record);
      if (!nextUser.email.endsWith(ALLOWED_DOMAIN)) {
        setError(`Access is restricted to ${ALLOWED_DOMAIN} accounts.`);
        setState('denied');
        setTimeout(() => signOut(window.location.href), 1800);
        return;
      }

      setUser(nextUser);
      setState('ok');
    } catch (err) {
      setError(err?.message || 'Unknown error');
      setState('sdk-error');
    }
  }, []);

  useEffect(() => {
    check();
  }, [check]);

  // A 401 from any api() call anywhere in the tree drops us back to the sign-in screen instead of
  // leaving a dead UI showing stale data behind an expired session.
  useEffect(() => {
    const onAuthLost = () => {
      signInMounted.current = false;
      setUser(null);
      setState('sign-in');
    };
    window.addEventListener(AUTH_LOST_EVENT, onAuthLost);
    return () => window.removeEventListener(AUTH_LOST_EVENT, onAuthLost);
  }, []);

  // Mount the Catalyst widget only once we're actually showing the sign-in screen — the target div
  // has to exist in the DOM before signIn() is called.
  useEffect(() => {
    if (state !== 'sign-in' || signInMounted.current) return;
    if (!window.catalyst?.auth) return;
    try {
      window.catalyst.auth.signIn('catalyst-signin-div', {
        signin_providers_only: true,
        service_url: window.location.href,
      });
      signInMounted.current = true;
    } catch (err) {
      setError(err?.message || 'The sign-in widget failed to render.');
      setState('sdk-error');
    }
  }, [state]);

  if (state === 'ok') return children(user);

  return (
    <div className="gate">
      <div className="gate-card">
        <div className="gate-brand">
          <span className="vault-glyph" aria-hidden="true">▣</span>
          <div>
            <h1>WSM Security</h1>
            <p className="vault-sub">Team workspace · Zoho Catalyst</p>
          </div>
        </div>

        {state === 'loading' && <p className="gate-msg">Checking your session…</p>}

        {state === 'sign-in' && (
          <>
            <p className="gate-msg">Internal tool — {ALLOWED_DOMAIN} accounts only.</p>
            <div id="catalyst-signin-div" className="gate-signin" />
          </>
        )}

        {state === 'denied' && (
          <>
            <p className="gate-msg gate-msg-err">{error}</p>
            <p className="gate-msg">Signing you out…</p>
          </>
        )}

        {state === 'sdk-error' && (
          <>
            <h2 className="gate-title">Sign-in unavailable</h2>
            <p className="gate-msg gate-msg-err">{error}</p>
            <button className="btn btn-ghost" type="button" onClick={() => window.location.reload()}>
              Retry
            </button>
          </>
        )}
      </div>
    </div>
  );
}
