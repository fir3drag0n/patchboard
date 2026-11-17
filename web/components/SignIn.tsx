// Settings, Connections, Sign-in: off or one password, set here. A reverse
// proxy or OIDC is set in the environment and shows here as locked.

import { useEffect, useRef, useState } from 'react';
import { useStore } from '../lib/store.tsx';
import { Section } from './ui.tsx';
import { msg, t as tr } from '../lib/i18n.ts';
import { copyText } from '../lib/copy.ts';

interface AuthSettings {
  mode: 'none' | 'password' | 'forward' | 'oidc';
  locked: boolean;
  hookToken?: string | null;
  hosts: string[];
  hostsLocked: boolean;
}

const ABOUT: Record<AuthSettings['mode'], string> = {
  none: msg('Anyone who can reach Patchboard can use it. Fine on Tailscale or a firewalled home network.'),
  password: msg('Patchboard asks for a password. A sign-in lasts 30 days on each device.'),
  forward: msg('Your reverse proxy signs people in and passes their name along.'),
  oidc: msg('People sign in through your identity provider.'),
};

export function SignIn() {
  const readOnly = !!useStore().snap?.readOnly;
  const [s, setS] = useState<AuthSettings | null>(null);
  const [editing, setEditing] = useState<'on' | 'change' | 'off' | null>(null);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<'' | 'yes' | 'no'>('');
  const hookField = useRef<HTMLInputElement>(null);
  const [hosts, setHosts] = useState<string | null>(null);
  const [hostsMsg, setHostsMsg] = useState<{ text: string; bad?: boolean } | null>(null);

  useEffect(() => {
    fetch('/api/auth/settings')
      .then((r) => r.json())
      .then(setS, () => setS(null));
  }, []);
  if (!s) return null;

  const reset = () => (setEditing(null), setCurrent(''), setNext(''), setAgain(''), setErr(''));
  const save = async (mode: 'none' | 'password') => {
    if (mode === 'password' && next !== again) return setErr(tr("The two passwords don't match."));
    setBusy(true);
    setErr('');
    const res = await fetch('/api/auth/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-Patchboard': 'action' },
      body: JSON.stringify({ mode, password: next, current }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setErr(body.error ?? `HTTP ${res.status}`);
    // The session state lives in the shell; a reload picks up the new mode.
    location.reload();
  };

  const saveHosts = async () => {
    setHostsMsg(null);
    const res = await fetch('/api/auth/hosts', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-Patchboard': 'action' },
      body: JSON.stringify({ hosts: hosts ?? '' }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return setHostsMsg({ text: body.error ?? `HTTP ${res.status}`, bad: true });
    setS({ ...s, hosts: body.hosts });
    setHosts(null);
    setHostsMsg({ text: tr('Saved.') });
  };

  const hook = s.hookToken ? `${location.origin}/api/hooks/diun?token=${s.hookToken}` : '';
  const pw = (label: string, value: string, set: (v: string) => void, auto: string) => (
    <label className="signin-field">
      <span>{tr(label)}</span>
      <input className="field" type="password" autoComplete={auto} value={value} onChange={(e) => set(e.target.value)} />
    </label>
  );

  return (
    <Section title="Sign-in" count={s.mode === 'none' ? tr('Off') : s.mode === 'password' ? tr('Password') : s.mode === 'forward' ? tr('Reverse proxy') : 'OIDC'}>
      <p className="settings-note">
        {tr(ABOUT[s.mode])}
        {s.locked && ` ${tr('Set in the environment, so it changes there.')}`}
      </p>

      {!s.locked && !readOnly && !editing && (
        <div className="signin-actions">
          {s.mode === 'none' ? (
            <button type="button" className="button button-quiet" onClick={() => setEditing('on')}>
              {tr('Turn on a password')}
            </button>
          ) : (
            <>
              <button type="button" className="button button-quiet" onClick={() => setEditing('change')}>
                {tr('Change password')}
              </button>
              <button type="button" className="text-button" onClick={() => setEditing('off')}>
                {tr('Turn off')}
              </button>
            </>
          )}
        </div>
      )}

      {(s.mode === 'password' || s.mode === 'oidc') && !editing && (
        <div className="signin-actions">
          <button
            type="button"
            className="text-button"
            onClick={async () => {
              await fetch('/api/logout', { method: 'POST', headers: { 'X-Patchboard': 'action' } });
              location.assign('/');
            }}
          >
            {tr('Sign out of this browser')}
          </button>
        </div>
      )}

      {editing && (
        <form
          className="signin-form"
          onSubmit={(e) => {
            e.preventDefault();
            void save(editing === 'off' ? 'none' : 'password');
          }}
        >
          {editing !== 'on' && pw(msg('Current password'), current, setCurrent, 'current-password')}
          {editing !== 'off' && pw(msg('New password'), next, setNext, 'new-password')}
          {editing !== 'off' && pw(msg('Once more'), again, setAgain, 'new-password')}
          <div className="signin-actions">
            <button type="submit" className={editing === 'off' ? 'button req-decline' : 'button'} disabled={busy}>
              {editing === 'on' ? tr('Turn on') : editing === 'change' ? tr('Change password') : tr('Turn off sign-in')}
            </button>
            <button type="button" className="text-button" onClick={reset}>
              {tr('Cancel')}
            </button>
            {err && <span className="crit-text">{err}</span>}
          </div>
          {editing !== 'off' && <p className="settings-note">{tr('Every other device signs out. Locked out later? Set AUTH=none in the environment and restart.')}</p>}
        </form>
      )}

      <div className="signin-hosts">
        <label className="signin-field">
          <span>{tr('Other names you open Patchboard by, like the domain your reverse proxy serves')}</span>
          <input
            className="field mono"
            value={hosts ?? s.hosts.join(', ')}
            placeholder="dash.example.com"
            disabled={s.hostsLocked || readOnly}
            onChange={(e) => setHosts(e.target.value)}
          />
        </label>
        {hosts !== null && (
          <button type="button" className="button button-quiet" onClick={() => void saveHosts()}>
            {tr('Save')}
          </button>
        )}
        {hostsMsg && <span className={hostsMsg.bad ? 'crit-text' : 'signin-saved'}>{hostsMsg.text}</span>}
      </div>
      <p className="settings-note">{tr('IP addresses and home names like nas.local always work.')}{s.hostsLocked && ' Set in the environment, so it changes there.'}</p>

      {hook && (
        <div className="signin-hook">
          <p className="settings-note">{tr('Diun\'s webhook, with its token. Put it in Diun\'s DIUN_NOTIF_WEBHOOK_ENDPOINT:')}</p>
          <div className="device-copy">
            <input ref={hookField} className="field mono" readOnly value={hook} aria-label={tr('Diun\'s webhook, with its token')} onFocus={(e) => e.currentTarget.select()} />
            <button
              type="button"
              className="button button-quiet"
              onClick={async () => {
                const ok = await copyText(hook);
                if (!ok) hookField.current?.select();
                setCopied(ok ? 'yes' : 'no');
                setTimeout(() => setCopied(''), 2500);
              }}
            >
              {copied === 'yes' ? tr('Copied') : copied === 'no' ? tr('Selected: copy it') : tr('Copy')}
            </button>
          </div>
        </div>
      )}
    </Section>
  );
}
