import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkPictures, labelSpots } from '../../shared/car-pictures.ts';

const src = '/api/icons/0123456789abcdef.png';

test('car pictures: only uploads here, spots inside the picture, a hidden tire allowed', () => {
  const ok = checkPictures([{ src, at: { fl: [20, 70], fr: [80, 60], rl: [35, 75], rr: null } }]);
  assert.ok(ok.ok);
  assert.equal(ok.ok && ok.pictures[0].at.rr, null);
  assert.equal(checkPictures([{ src: 'https://example.com/car.png', at: {} }]).ok, false);
  assert.equal(checkPictures([{ src, at: { fl: [120, 10] } }]).ok, false);
  assert.equal(checkPictures(Array(7).fill({ src, at: {} })).ok, false);
});

test('each pressure sits beside its tire, on its nearer side, clear of the next', () => {
  const h = 75;
  const l = labelSpots({ fl: [25, 60], fr: [43, 57], rl: null, rr: [73, 55] }, h);
  assert.equal(l.fl.left, true);
  assert.equal(l.fr.left, true);
  assert.equal(l.rr.left, false);
  assert.equal(l.rl.left, false, 'the hidden tire takes the emptier side');
  assert.ok(Math.abs(l.fl.y - l.fr.y) >= 11, 'two on one side clear each other');
  assert.ok(Math.abs(l.rr.y - (55 * h) / 100) < 1, 'a lone label sits at its tire');
  for (const s of Object.values(l)) assert.ok(s.y >= 8 && s.y <= h - 4);
});

test('a picture may mark its charge port, inside the picture', () => {
  const ok = checkPictures([{ src, at: { fl: null, fr: null, rl: null, rr: null }, port: [81.5, 46] }]);
  assert.ok(ok.ok && ok.pictures[0].port?.[0] === 81.5);
  assert.equal(checkPictures([{ src, at: {}, port: [140, 2] }]).ok, false);
});

test('a picture says which view it is and which part of it to show', () => {
  const ok = checkPictures([{ src, at: { fl: null, fr: null, rl: null, rr: null }, view: 'side', crop: [10, 20, 50, 40] }]);
  assert.ok(ok.ok && ok.pictures[0].view === 'side' && ok.pictures[0].crop?.[2] === 50);
  assert.equal(checkPictures([{ src, at: {}, view: 'underside' }]).ok, false);
  assert.equal(checkPictures([{ src, at: {}, crop: [60, 0, 50, 50] }]).ok, false, 'runs off the picture');
});

test('car commands: only the ones Tessie takes, and a charge limit Tesla accepts', async () => {
  const { CAR_COMMANDS, checkLimit, isCarCommand } = await import('../../shared/car-commands.ts');
  assert.equal(isCarCommand('unlock'), true);
  assert.equal(isCarCommand('frunk'), true);
  assert.equal(isCarCommand('toString'), false, 'not an inherited name');
  assert.equal(isCarCommand('boost'), false);
  assert.equal(CAR_COMMANDS.trunk, 'activate_rear_trunk');
  assert.equal(checkLimit(90), 90);
  assert.equal(checkLimit('80'), 80);
  assert.equal(checkLimit(49), null);
  assert.equal(checkLimit(101), null);
  assert.equal(checkLimit('lots'), null);
});

test('car pictures: three-quarter views join the turntable; an unknown view does not', () => {
  const at = { fl: null, fr: null, rl: null, rr: null };
  assert.equal(checkPictures([{ src, at, view: 'front34' }]).ok, true);
  assert.equal(checkPictures([{ src, at, view: 'rear34' }]).ok, true);
  assert.equal(checkPictures([{ src, at, view: 'iso' }]).ok, false);
});

test('car commands: unlocking and opening are the ones that need sign-in', async () => {
  const { OPENS_CAR } = await import('../../shared/car-commands.ts');
  assert.deepEqual([...OPENS_CAR].sort(), ['frunk', 'trunk', 'unlock']);
});

test('the demo car: its drawings pass as uploads, with a Car board, seeded once', async () => {
  const { seedDemoCar } = await import('../demo-car.ts');
  const { kvGet } = await import('../db.ts');
  const { removeBoard, savedBoards } = await import('../boards.ts');
  seedDemoCar();
  const pics = kvGet<Record<string, unknown[]>>('car-pictures')?.DEMO;
  assert.equal(pics?.length, 6);
  assert.ok(checkPictures(pics).ok);
  assert.ok(savedBoards().some((b) => b.id === 'car'));
  removeBoard('car');
  seedDemoCar();
  assert.ok(!savedBoards().some((b) => b.id === 'car'), 'a deleted Car board stays deleted');
});
