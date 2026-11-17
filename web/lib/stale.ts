// A page whose code failed to load, in each browser's words: almost always a
// tab older than the last update, asking for files the new build replaced.
const STALE = /Importing a module script failed|Failed to fetch dynamically imported module|error loading dynamically imported module|Unable to preload CSS|Loading chunk|ChunkLoadError/i;

export const isStaleBuild = (err: unknown): boolean => STALE.test(err instanceof Error ? `${err.name} ${err.message}` : String(err));
