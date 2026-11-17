// What shows when a page fails. A page whose code can't load is almost always
// a tab older than the last update, asking for files the new build replaced:
// that reloads once, by itself, onto the new build. Anything else says what
// broke and offers a reload.

import { useEffect } from 'react';
import { isRouteErrorResponse, useRouteError } from 'react-router-dom';
import { t as tr } from '../lib/i18n.ts';
import { isStaleBuild } from '../lib/stale.ts';

const KEY = 'pb-stale-reload';

/** A page's code failed to load: reload onto the current build, unless that just happened. */
export function reloadForNewBuild(): boolean {
  try {
    const last = Number(sessionStorage.getItem(KEY) ?? 0);
    if (Date.now() - last < 30_000) return false;
    sessionStorage.setItem(KEY, String(Date.now()));
  } catch {
    /* without storage, reload anyway: a loop needs a broken build on the server too */
  }
  location.reload();
  return true;
}

export function RouteError() {
  const err = useRouteError();
  const stale = isStaleBuild(err);
  const reloading = stale && typeof sessionStorage !== 'undefined' && Date.now() - Number(sessionStorage.getItem(KEY) ?? 0) >= 30_000;
  useEffect(() => {
    if (stale) reloadForNewBuild();
  }, [stale]);
  if (reloading) return <div className="page" aria-busy="true" />;
  const text = isRouteErrorResponse(err) ? `${err.status} ${err.statusText}` : err instanceof Error ? err.message : String(err);
  return (
    <div className="page not-found" role="alert">
      <h1 className="page-title">{stale ? tr('This page didn’t load.') : tr('This page hit an error.')}</h1>
      <p>{stale ? tr('Patchboard was updated, or the connection dropped while it loaded. Reload to open it.') : tr('Reload to try again. If it keeps happening, the message below says what broke.')}</p>
      <p className="not-found-links">
        <button type="button" className="button" onClick={() => location.reload()}>
          {tr('Reload')}
        </button>
      </p>
      {!stale && <pre className="route-error-text">{text}</pre>}
    </div>
  );
}
