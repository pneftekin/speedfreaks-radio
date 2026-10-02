/**
 * AzuraCast API configuration and response mapping.
 *
 * Station shortcode on speedfreaks.live is "speedfreaks".
 * Adjust these constants if the backend changes.
 */
const API_BASE = 'https://radio.speedfreaks.live/api/nowplaying';
const STATION_SHORTCODE = 'speedfreaks';
const REQUESTS_URL = 'https://radio.speedfreaks.live/api/station/1/requests';
export const DEMO_MODE = import.meta.env.VITE_DEMO_MODE === 'true';

const PREVIEW_STATION = {
  is_online: true,
  now_playing: {
    song: { title: 'cutting my fingers off', artist: 'turnover', album: 'peripheral vision', art: './preview-art.svg' },
    elapsed: 87, duration: 211, remaining: 124, played_at: Math.floor(Date.now() / 1000) - 87,
  },
  listeners: { current: 128 },
  song_history: [
    { song: { title: 'your graduation', artist: 'modern baseball', art: './preview-art.svg' }, played_at: Math.floor(Date.now() / 1000) - 430 },
    { song: { title: 'constant headache', artist: 'joyce manor', art: './preview-art.svg' }, played_at: Math.floor(Date.now() / 1000) - 710 },
    { song: { title: 'never meant', artist: 'american football', art: './preview-art.svg' }, played_at: Math.floor(Date.now() / 1000) - 950 },
  ],
};

/** Live stream URL — from station.listen_url in the API response. */
export const STREAM_URL = 'https://radio.speedfreaks.live/listen/speedfreaks/radio.mp3';

/** How often to poll the Now Playing API (milliseconds). */
export const POLL_INTERVAL_MS = 15_000;

/** Local tick interval for progress bar between API polls. */
export const PROGRESS_TICK_MS = 1_000;

/**
 * Fetch raw Now Playing data from AzuraCast.
 * Returns the station object (single-station endpoint).
 */
export async function fetchNowPlaying() {
  if (DEMO_MODE) return PREVIEW_STATION;
  const url = `${API_BASE}/${STATION_SHORTCODE}`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Now Playing API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  return data;
}

/** Fetch the public list of songs available for listener requests. */
export async function fetchRequestableSongs() {
  const response = await fetch(REQUESTS_URL);

  if (!response.ok) {
    throw new Error(`Request list error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  if (!Array.isArray(data)) throw new Error('Request list returned an invalid response.');

  return data
    .filter((item) => item?.request_url && item?.song)
    .map((item) => ({
      requestUrl: new URL(item.request_url, REQUESTS_URL).href,
      title: item.song.title || 'unknown title',
      artist: item.song.artist || 'unknown artist',
      artUrl: item.song.art || '',
    }));
}

/** Submit a public listener request using the URL supplied for that track. */
export async function submitSongRequest(requestUrl) {
  const response = await fetch(requestUrl, { method: 'POST' });
  let data = {};

  try {
    data = await response.json();
  } catch {
    // Preserve the HTTP status when the public endpoint returns no JSON body.
  }

  if (!response.ok) {
    const error = new Error(data.message || `Request failed: ${response.status} ${response.statusText}`);
    error.status = response.status;
    throw error;
  }

  return data;
}

/**
 * Map AzuraCast response to a normalized shape for the UI.
 * All AzuraCast field access is isolated here for easy correction.
 */
export function mapNowPlaying(raw) {
  const np = raw.now_playing ?? {};
  const song = np.song ?? {};

  return {
    isOnline: raw.is_online ?? false,
    title: song.title || 'unknown title',
    artist: song.artist || 'unknown artist',
    album: song.album || '',
    artUrl: song.art || '',
    elapsed: np.elapsed ?? 0,
    duration: np.duration ?? 0,
    remaining: np.remaining ?? 0,
    playedAt: np.played_at ?? null,
    listeners: raw.listeners?.current ?? raw.listeners?.total ?? 0,
    songHistory: (raw.song_history ?? []).map(mapHistoryEntry),
  };
}

function mapHistoryEntry(entry) {
  const song = entry.song ?? {};
  return {
    title: song.title || 'unknown title',
    artist: song.artist || 'unknown artist',
    artUrl: song.art || '',
    playedAt: entry.played_at ?? null,
  };
}

/** Format seconds as MM:SS */
export function formatTime(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

/** Calculate progress percentage from elapsed and duration. */
export function calcProgress(elapsed, duration) {
  if (!duration || duration <= 0) return 0;
  return Math.min(100, Math.max(0, (elapsed / duration) * 100));
}

/**
 * Estimate current elapsed time between API polls using played_at timestamp.
 * Falls back to server-provided elapsed if played_at is unavailable.
 */
export function estimateElapsed(serverElapsed, playedAt, fetchedAt) {
  if (playedAt && fetchedAt) {
    const sinceFetch = Math.floor((Date.now() - fetchedAt) / 1000);
    return serverElapsed + sinceFetch;
  }
  return serverElapsed;
}