export function hasUsableMetadata(artist, title) {
  return Boolean(
    typeof artist === 'string' &&
      typeof title === 'string' &&
      artist.trim() &&
      title.trim() &&
      artist.trim() !== 'unknown artist' &&
      title.trim() !== 'unknown title',
  );
}

export function createTrackIdentity({ artist, title, playedAt }) {
  const stationInstance = playedAt === null || playedAt === undefined ? '' : String(playedAt);
  return `${stationInstance}|${artist.trim()}|${title.trim()}`;
}

export function getScrobbleThreshold(duration) {
  if (!Number.isFinite(duration) || duration <= 30) return null;
  return Math.min(duration / 2, 240);
}