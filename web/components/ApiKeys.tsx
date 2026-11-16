// Settings, Connections, Sign-in and keys: keys for the read-only API, one per
// script or AI tool. A new key shows once, with the lines that use it.

import { useEffect, useState } from 'react';
import type { ApiKeyInfo } from '../../shared/types.ts';
import { agoLong } from '../lib/format.ts';
import { HELP } from '../lib/docs.ts';
import { useStore } from '../lib/store.tsx';
import { HoldButton } from './Hold.tsx';
import { Section } from './ui.tsx';

const ACTION = { 'Content-Type': 'application/json', 'X-Patchboard': 'action' };

function Copyable({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="device-copy">
      <input className="field mono" readOnly value={text} aria-label={label} onFocus={(e) => e.currentTarget.select()} />
      <button
        type="button"
        className="button button-quiet"
        onClick={() =>
          void navigator.clipboard?.writeText(text).then(
            () => setCopied(true),
            // Browsers allow the clipboard only on https or localhost; the field selects itself to copy by hand.
            () => {},
          )
        }
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}

export function ApiKeys() {
  const readOnly = !!useStore().snap?.readOnly;
  const [list, setList] = useState<ApiKeyInfo[] | null>(null);
  const [name, setName] = useState('');
  const [made, setMade] = useState<{ key: string; name: string } | null>(null);
  const [err, setErr] = useState('');
  const load = async () => {
    const res = await fetch('/api/keys');
    if (res.ok) setList(((await res.json()) as { keys: ApiKeyInfo[] }).keys);
  };
  useEffect(() => {
    void load();
  }, []);
  const add = async () => {
    setErr('');
    const res = await fetch('/api/keys', { method: 'POST', headers: ACTION, body: JSON.stringify({ name }) });
    const body = (await res.json().catch(() => ({}))) as { key?: string; error?: string };
    if (!res.ok || !body.key) return setErr(body.error ?? `HTTP ${res.status}`);
    setMade({ key: body.key, name: name.trim() });
    setName('');
    await load();
  };
  const revoke = async (id: string) => {
    await fetch(`/api/keys/${id}`, { method: 'DELETE', headers: ACTION });
    await load();
  };
  if (!list) return null;
  const mcp = `${location.origin}/api/v1/mcp`;

  return (
    <Section title="API keys" count={list.length ? String(list.length) : undefined}>
      <p className="settings-note">
        For scripts and AI tools: a key reads what needs you, the containers, the server and any widget&apos;s number, and changes nothing.{' '}
        <a href={HELP.api} target="_blank" rel="noreferrer">
          The API and MCP
        </a>
      </p>
      {made && (
        <div className="api-key-made" role="status">
          <p>
            The key for <strong>{made.name}</strong>. Patchboard shows it only now.
          </p>
          <Copyable text={made.key} label={`API key for ${made.name}`} />
          <p className="settings-note">Claude Code, as an MCP server:</p>
          <Copyable text={`claude mcp add --transport http patchboard ${mcp} --header "Authorization: Bearer ${made.key}"`} label="Command to add Patchboard to Claude Code" />
        </div>
      )}
      {list.length > 0 && (
        <ul className="audit keys">
          {list.map((k) => (
            <li key={k.id}>
              <span>{k.name}</span>
              <time>{k.lastUsed ? `Used ${agoLong(k.lastUsed)}` : 'Not used yet'}</time>
              {!readOnly && (
                <HoldButton className="text-button" danger hint="Hold to revoke. Anything using it stops working." onConfirm={() => void revoke(k.id)}>
                  Revoke
                </HoldButton>
              )}
            </li>
          ))}
        </ul>
      )}
      {!readOnly && (
        <form
          className="api-key-add"
          onSubmit={(e) => {
            e.preventDefault();
            void add();
          }}
        >
          <input className="field" value={name} maxLength={40} placeholder="What will use it" aria-label="API key name" onChange={(e) => setName(e.target.value)} />
          <button type="submit" className="button button-quiet" disabled={!name.trim()}>
            Make a key
          </button>
          {err && (
            <span className="crit-text" role="alert">
              {err}
            </span>
          )}
        </form>
      )}
    </Section>
  );
}
