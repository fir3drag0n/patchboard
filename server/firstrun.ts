// First run: one sheet that names the server, finds its place and adds its
// apps. It shows until someone finishes it, once per server. An install that
// already has a saved board, apps or name skips it.

import { kvGet, kvSet } from './db.ts';
import { getJson } from './http.ts';

export function firstRunPending(): boolean {
  return kvGet<boolean>('first-run-done') !== true;
}

export function finishFirstRun(): void {
  kvSet('first-run-done', true);
}

/** An upgrade from before the sheet existed: anything saved means it's set up. */
export function markExistingInstall(): void {
  if (!firstRunPending()) return;
  if (['board', 'boards', 'app-order', 'brand', 'appearance', 'pages'].some((k) => kvGet<unknown>(k) != null)) finishFirstRun();
}

export interface Place {
  name: string;
  /** "California, United States": enough to tell two Springfields apart. */
  area: string;
  lat: number;
  lon: number;
}

const DEMO_PLACES: Place[] = [
  { name: 'Riverside', area: 'California, United States', lat: 33.95, lon: -117.4 },
  { name: 'Riverside', area: 'Ontario, Canada', lat: 42.25, lon: -82.96 },
];

/** Towns matching what was typed, from Open-Meteo's free place search. */
export async function findPlaces(q: string, lang: string, demo: boolean): Promise<Place[]> {
  const query = q.trim().slice(0, 80);
  if (query.length < 2) return [];
  if (demo) return DEMO_PLACES.filter((p) => p.name.toLowerCase().startsWith(query.toLowerCase().slice(0, 3)));
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=6&format=json&language=${encodeURIComponent(lang || 'en')}`;
  const body = await getJson<{ results?: { name: string; admin1?: string; country?: string; latitude: number; longitude: number }[] }>(url, {}, 6000);
  return (body.results ?? []).map((r) => ({
    name: r.name,
    area: [r.admin1, r.country].filter(Boolean).join(', '),
    lat: Math.round(r.latitude * 100) / 100,
    lon: Math.round(r.longitude * 100) / 100,
  }));
}
