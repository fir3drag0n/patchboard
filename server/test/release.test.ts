import assert from 'node:assert/strict';
import { test } from 'node:test';
import { releaseTitle } from '../../shared/release.ts';

test('release names read as a person would say them', () => {
  assert.equal(releaseTitle('iCarly 2007 S06 1080p AMZN WEB-DL DDP5 1 H 264-Dooky'), 'iCarly S06');
  assert.equal(releaseTitle('SuperKitties 2023 S02 1080p DSNP WEB-DL MULTI DDP 5 1 H 264-OldT'), 'SuperKitties S02');
  assert.equal(releaseTitle('Ludwig.S01.1080p.AMZN.WEB-DL.DDP2.0.H.264-RAWR'), 'Ludwig S01');
  assert.equal(releaseTitle('The.Bear.S04E04.720p.HULU.WEBRip.x264'), 'The Bear S04E04');
  assert.equal(releaseTitle('[Spoony] Demon Slayer - Kimetsu no Yaiba - Season 03 (Entertainment District) (WEB 1080p)'), 'Demon Slayer - Kimetsu no Yaiba, season 3');
  assert.equal(releaseTitle('Some.Movie.2023.1080p.BluRay.x264-GRP'), 'Some Movie (2023)');
  assert.equal(releaseTitle('Blade Runner 2049 (2017) 2160p UHD BluRay REMUX'), 'Blade Runner 2049 (2017)');
  // Not a release name: left alone.
  assert.equal(releaseTitle('ubuntu-24.04-desktop-amd64.iso'), 'ubuntu-24.04-desktop-amd64.iso');
  assert.equal(releaseTitle('Family photos 2019'), 'Family photos 2019');
});
