// Ideas, app requests and problems go to GitHub as issues, through the
// repo's own forms. Patchboard opens the form with what it already knows
// filled in: its version, the browser, the page. Nothing private goes along:
// no addresses, container names or settings. The person sends it from their
// own GitHub account.

const NEW_ISSUE = 'https://github.com/sourpatchdad/patchboard/issues/new';

/** "Safari on iPhone (installed as an app)", from the browser's own description. */
export function browserLabel(ua = navigator.userAgent, installed = matchMedia('(display-mode: standalone)').matches): string {
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\/|CriOS\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'A browser';
  const device = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : 'another device';
  return `${browser} on ${device}${installed ? ' (installed as an app)' : ''}`;
}

/** The page's name only: /c/plex is "a container's page", never the container. */
export function pageLabel(path: string): string {
  const top = path.split('/')[1] ?? '';
  if (!top) return 'Home';
  if (top === 'c') return "a container's page";
  if (top === 'b') return 'a board';
  if (top === 'w') return 'a widget page';
  return top.charAt(0).toUpperCase() + top.slice(1);
}

const issue = (template: string, fields: Record<string, string>) => `${NEW_ISSUE}?${new URLSearchParams({ template, ...fields })}`;

export function ideaUrl(version: string | undefined, path: string): string {
  return issue('feature.yml', { else: `Sent from ${pageLabel(path)}, Patchboard ${version ?? 'unknown version'}.` });
}

export function appUrl(): string {
  return issue('integration.yml', {});
}

export function problemUrl(version: string | undefined): string {
  return issue('bug.yml', { ...(version ? { version } : {}), browser: browserLabel() });
}
