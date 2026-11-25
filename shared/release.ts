// A release name as a person would say it: "iCarly 2007 S06 1080p AMZN
// WEB-DL DDP5 1 H 264-Dooky" is "iCarly S06", and "Some.Movie.2023.1080p
// .BluRay.x264" is "Some Movie (2023)". Anything it can't read stays as given.

const QUALITY = /\b(2160p|1080p|720p|480p|4k|uhd|web-?dl|webrip|web|bluray|blu-ray|bdrip|brrip|hdtv|dvdrip|remux|hdr|dv|x26[45]|h ?26[45]|hevc|avc|aac|ddp?\d?|atmos|amzn|nf|dsnp|atvp|hmax|hulu|pcok|proper|repack|multi)\b/i;

export function releaseTitle(name: string): string {
  // Leading [group] tags, and dots or underscores used as spaces.
  const s = name.replace(/^(\[[^\]]*\]\s*)+/, '').replace(/[._]+/g, ' ').replace(/\s+/g, ' ').trim();
  const clean = (t: string) => t.replace(/[\s(\-–]+$/, '').trim();
  // A show: S06, S02E04, or "Season 03".
  const ep = /^(.+?)\s(?:\(?(?:19|20)\d{2}\)?\s)?(S\d{1,2}(?:E\d{1,3}(?:-?E\d{1,3})?)?)\b/i.exec(s);
  if (ep && clean(ep[1])) return `${clean(ep[1])} ${ep[2].toUpperCase()}`;
  const season = /^(.+?)\s(?:-\s)?season\s(\d{1,2})\b/i.exec(s);
  if (season && clean(season[1])) return `${clean(season[1])}, season ${Number(season[2])}`;
  // A movie: the title, then its year (the last one, for "Blade Runner 2049
  // (2017)"), then the quality words.
  const movie = /^(.+)\s\(?((?:19|20)\d{2})\)?\s(.*)$/.exec(s);
  if (movie && clean(movie[1]) && QUALITY.test(movie[3])) return `${clean(movie[1])} (${movie[2]})`;
  return name;
}
