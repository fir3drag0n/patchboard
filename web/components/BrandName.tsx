// Settings, Look: the name in the header and the tab.
// Shared by every device, unlike the rest of the Look tab.

import { useState } from 'react';
import { useStore } from '../lib/store.tsx';
import { Section } from './ui.tsx';
import { t as tr } from '../lib/i18n.ts';

/** The dashboard name, saved on Enter or Save. */
export function NameForm() {
  const { snap } = useStore();
  const brand = snap?.brand ?? {};
  const [name, setName] = useState<string | null>(null);
  const [err, setErr] = useState('');
  if (!snap) return null;
  const readOnly = !!snap.readOnly;

  const save = async (next: { name?: string }) => {
    setErr('');
    const res = await fetch('/api/brand', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-Patchboard': 'action' },
      body: JSON.stringify({ name: brand.name ?? '', ...next }),
    });
    if (!res.ok) return setErr(((await res.json().catch(() => ({}))) as { error?: string }).error ?? `HTTP ${res.status}`);
    setName(null);
  };

  return (
    <form
      className="brand-row"
      onSubmit={(e) => {
        e.preventDefault();
        void save({ name: name ?? '' });
      }}
    >
      <input
        className="field"
        value={name ?? brand.name ?? ''}
        placeholder={tr('Patchboard')}
        maxLength={40}
        aria-label={tr('Name')}
        disabled={readOnly}
        onChange={(e) => setName(e.target.value)}
      />
      {name !== null && (
        <button type="submit" className="button button-quiet">
          {tr('Save')}
        </button>
      )}
      {err && <span className="crit-text">{err}</span>}
    </form>
  );
}

export function BrandName() {
  return (
    <Section title="Name" count={tr('every device')} className="span-all">
      <NameForm />
    </Section>
  );
}
