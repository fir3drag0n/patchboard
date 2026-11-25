// The demo's Tesla, drawn: a general-arrangement sheet (side, front, rear
// and top) and two three-quarter renders, placed on the demo car the first
// time demo mode starts, with a Car board that shows it as a live
// engineering drawing. Seeded once: delete the board and it stays deleted.

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { STARTERS } from '../shared/board.ts';
import type { CarPicture } from '../shared/car-pictures.ts';
import { exportExtras, saveExtras } from './boards.ts';
import { config } from './config.ts';
import { kvGet, kvSet } from './db.ts';

/** Stored the way an upload is: named by its contents, in the data folder's icons. */
function place(file: string): string {
  const body = readFileSync(new URL(`./demo-car/${file}`, import.meta.url));
  const name = `${createHash('sha256').update(body).digest('hex').slice(0, 16)}.webp`;
  const dir = join(config.dataDir, 'icons');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), body);
  return `/api/icons/${name}`;
}

/** Each view's part of its picture, its tires and its charge port, in percent of the picture. */
export function demoCarViews(sheet: string, front34: string, rear34: string): CarPicture[] {
  const none = { fl: null, fr: null, rl: null, rr: null };
  return [
    { src: sheet, at: { fl: [35.5, 58.9], fr: null, rl: [75.7, 58.9], rr: null }, port: [84.5, 43.5], view: 'side', crop: [23, 30.5, 64.3, 34.5] },
    { src: sheet, at: none, view: 'front', crop: [25.5, 8.5, 15, 17.5] },
    { src: sheet, at: none, view: 'rear', crop: [45.8, 8.5, 14.6, 17.5] },
    { src: sheet, at: none, view: 'top', crop: [66.22, 7.2, 25.18, 19.1] },
    { src: front34, at: { fl: [45.9, 67.4], fr: [14, 75.2], rl: [89, 61], rr: null }, view: 'front34' },
    { src: rear34, at: { fl: [10.4, 59.6], fr: null, rl: [46.9, 67.4], rr: [83, 74.2] }, port: [54.6, 40.8], view: 'rear34' },
  ];
}

export function seedDemoCar(): void {
  if (kvGet('demo-car-seeded')) return;
  const pictures = demoCarViews(place('sheet.webp'), place('front34.webp'), place('rear34.webp'));
  kvSet('car-pictures', { ...(kvGet<Record<string, CarPicture[]>>('car-pictures') ?? {}), DEMO: pictures });
  const extras = exportExtras();
  const wall = STARTERS.find((s) => s.id === 'wall-car');
  if (wall && !extras.some((b) => b.id === 'car')) saveExtras([...extras, { id: 'car', board: { ...wall.board, name: 'Car' } }]);
  kvSet('demo-car-seeded', true);
}
