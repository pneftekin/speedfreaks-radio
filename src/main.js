import {
  DEMO_MODE,
  fetchNowPlaying,
  fetchRequestableSongs,
  mapNowPlaying,
  POLL_INTERVAL_MS,
  PROGRESS_TICK_MS,
  submitSongRequest,
} from './api.js';
import { createPlayer } from './player.js';
import { createTrackIdentity, getScrobbleThreshold, hasUsableMetadata } from './scrobble.js';
import {
  bindLastfmControls,
  closeHistory,
  getElements,
  openHistory,
  openRequestModal,
  closeRequestModal,
  renderRequestList,
  renderRequestStatus,
  renderHistory,
  renderLastfmState,
  renderLastfmStatus,
  renderNowPlaying,
  renderPlayerState,
  renderVolume,
  updateProgress,
} from './ui.js';

const els = getElements();
const player = createPlayer();

/** Latest normalized station data for progress ticks. */
let stationData = null;
let fetchedAt = 0;
let pollTimer = null;
let progressTimer = null;
let requestableSongs = [];
let playerState = { isPlaying: false, isBuffering: false };
let lastPlayerTick = performance.now();
let lastfmConnected = false;
let listeningTrack = null;

function resetListeningTrack(data) {
  if (!hasUsableMetadata(data.artist, data.title)) {
    listeningTrack = null;
    return;
  }

  const identity = createTrackIdentity(data);
  if (listeningTrack?.identity === identity) return;

  listeningTrack = {
    identity,
    artist: data.artist,
    title: data.title,
    duration: data.duration,
    listeningStart: Math.floor(Date.now() / 1000),
    listenedSeconds: 0,
    updateSent: false,
    scrobbleSubmitted: false,
  };
  lastPlayerTick = performance.now();
}

function markLastfmDisconnected(message) {
  lastfmConnected = false;
  renderLastfmState(els, { connected: false });
  renderLastfmStatus(els, message, true);
}

async function sendNowPlaying() {
  if (!lastfmConnected || !listeningTrack || listeningTrack.updateSent) return;
  listeningTrack.updateSent = true;

  try {
    const response = await fetch('/api/lastfm/now-playing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        artist: listeningTrack.artist,
        track: listeningTrack.title,
        duration: listeningTrack.duration,
        trackIdentity: listeningTrack.identity,
      }),
    });
    if (response.status === 401) {
      markLastfmDisconnected('Last.fm session expired. Please reconnect.');
      return;
    }
    if (!response.ok) throw new Error('Last.fm update unavailable.');
  } catch (err) {
    listeningTrack.updateSent = false;
    renderLastfmStatus(els, err.message, true);
  }
}

async function submitScrobble() {
  if (!lastfmConnected || !listeningTrack || listeningTrack.scrobbleSubmitted) return;
  listeningTrack.scrobbleSubmitted = true;
  renderLastfmStatus(els, 'scrobbling…');

  try {
    const response = await fetch('/api/lastfm/scrobble', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        artist: listeningTrack.artist,
        track: listeningTrack.title,
        duration: listeningTrack.duration,
        listeningStart: listeningTrack.listeningStart,
        trackIdentity: listeningTrack.identity,
      }),
    });
    if (response.status === 401) {
      markLastfmDisconnected('Last.fm session expired. Please reconnect.');
      return;
    }
    if (!response.ok) throw new Error('Last.fm scrobble unavailable.');
    renderLastfmStatus(els, 'scrobbled ✓');
  } catch (err) {
    renderLastfmStatus(els, err.message, true);
  }
}

function tickListeningTime() {
  const now = performance.now();
  const elapsed = (now - lastPlayerTick) / 1000;
  lastPlayerTick = now;

  if (!playerState.isPlaying || playerState.isBuffering || !listeningTrack) return;
  listeningTrack.listenedSeconds += elapsed;

  const threshold = getScrobbleThreshold(listeningTrack.duration);
  if (threshold !== null && listeningTrack.listenedSeconds >= threshold) submitScrobble();
}

async function refreshNowPlaying() {
  try {
    const raw = await fetchNowPlaying();
    stationData = mapNowPlaying(raw);
    fetchedAt = Date.now();
    const previousIdentity = listeningTrack?.identity;
    resetListeningTrack(stationData);

    renderNowPlaying(els, stationData, fetchedAt);
    renderHistory(els, stationData.songHistory);
    if (previousIdentity !== listeningTrack?.identity && playerState.isPlaying && !playerState.isBuffering) {
      sendNowPlaying();
    }
    clearStatusError();
  } catch (err) {
    showStatusError(err.message || 'Could not load station info.');
  }
}

function showStatusError(message) {
  els.playerStatus.classList.add('is-error');
  els.playerStatus.textContent = message;
}

function clearStatusError() {
  if (!player.errorMessage) {
    els.playerStatus.classList.remove('is-error');
  }
}

function tickProgress() {
  if (!stationData) return;
  updateProgress(
    els,
    stationData.elapsed,
    stationData.duration,
    stationData.playedAt,
    fetchedAt,
  );
}

function startPolling() {
  pollTimer = setInterval(refreshNowPlaying, POLL_INTERVAL_MS);
  progressTimer = setInterval(() => {
    tickListeningTime();
    tickProgress();
  }, PROGRESS_TICK_MS);
}

function bindPlayerControls() {
  player.onStateChange = (state) => {
    const wasActuallyPlaying = playerState.isPlaying && !playerState.isBuffering;
    const isActuallyPlaying = state.isPlaying && !state.isBuffering;
    const startedPlaying = !wasActuallyPlaying && isActuallyPlaying;
    playerState = state;
    lastPlayerTick = performance.now();
    renderPlayerState(els, state);
    renderVolume(els, state.volume);
    if (startedPlaying) {
      if (stationData) {
        resetListeningTrack(stationData);
        sendNowPlaying();
      }
    }
  };

  els.playToggle.addEventListener('click', async () => {
    try {
      await player.toggle();
    } catch (err) {
      showStatusError(err.message || 'Could not start playback.');
    }
  });

  els.volumeSlider.addEventListener('input', () => {
    const value = Number(els.volumeSlider.value);
    player.setVolume(value);
    renderVolume(els, value);
  });

  renderVolume(els, player.getVolumePercent());
  renderPlayerState(els, {
    isPlaying: false,
    isBuffering: false,
    error: null,
  });
}

function bindHistoryControls() {
  els.historyBtn.addEventListener('click', () => openHistory(els));
  els.historyClose.addEventListener('click', () => closeHistory(els));

  els.historyDialog.addEventListener('click', (event) => {
    const rect = els.historyDialog.getBoundingClientRect();
    const isBackdrop =
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom;

    if (isBackdrop) closeHistory(els);
  });
}

async function loadRequestableSongs() {
  renderRequestStatus(els, 'loading requestable songs…');
  try {
    requestableSongs = await fetchRequestableSongs();
    renderRequestList(els, requestableSongs, els.requestSearch.value, submitRequest);
  } catch (err) {
    renderRequestStatus(els, err.message || 'Could not load requestable songs.', 'error');
  }
}

async function submitRequest(track, button) {
  button.disabled = true;
  renderRequestStatus(els, `requesting ${track.title}…`);
  try {
    const result = await submitSongRequest(track.requestUrl);
    if (!result.success) {
      const message = result.message || 'The request was not accepted.';
      const state = /cooldown|rate.?limit|too many|wait/i.test(message) ? 'cooldown' : 'error';
      renderRequestStatus(els, message, state);
      return;
    }
    renderRequestStatus(els, result.message || 'Song requested successfully.', 'success');
  } catch (err) {
    const state = err.status === 429 || /cooldown|rate.?limit|too many|wait/i.test(err.message) ? 'cooldown' : 'error';
    renderRequestStatus(els, err.message || 'Could not submit song request.', state);
  } finally {
    button.disabled = false;
  }
}

function bindRequestControls() {
  els.requestBtn.addEventListener('click', () => {
    openRequestModal(els);
    if (!requestableSongs.length) loadRequestableSongs();
  });
  els.requestClose.addEventListener('click', () => closeRequestModal(els));
  els.requestSearchForm.addEventListener('submit', (event) => event.preventDefault());
  els.requestSearch.addEventListener('input', () =>
    renderRequestList(els, requestableSongs, els.requestSearch.value, submitRequest),
  );
  els.requestDialog.addEventListener('click', (event) => {
    const rect = els.requestDialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) {
      closeRequestModal(els);
    }
  });
  els.requestDialog.addEventListener('close', () => els.requestBtn.focus());
}

async function loadLastfmSession() {
  if (DEMO_MODE) return;
  try {
    const response = await fetch('/api/lastfm/me');
    if (!response.ok) throw new Error('Could not check Last.fm connection.');
    const state = await response.json();
    lastfmConnected = state.connected === true;
    renderLastfmState(els, state);
    if (lastfmConnected && playerState.isPlaying && !playerState.isBuffering) sendNowPlaying();
  } catch (err) {
    renderLastfmStatus(els, err.message, true);
  }
}

async function disconnectLastfm() {
  els.lastfmDisconnect.disabled = true;
  try {
    const response = await fetch('/api/lastfm/disconnect', { method: 'POST' });
    if (!response.ok) throw new Error('Could not disconnect Last.fm.');
    lastfmConnected = false;
    renderLastfmState(els, { connected: false });
    renderLastfmStatus(els, 'Last.fm disconnected.');
  } catch (err) {
    renderLastfmStatus(els, err.message, true);
  } finally {
    els.lastfmDisconnect.disabled = false;
  }
}

async function init() {
  if (DEMO_MODE) {
    document.documentElement.classList.add('demo-mode');
    const note = document.createElement('p');
    note.className = 'preview-note';
    note.textContent = 'interface preview · live services are not connected';
    document.querySelector('.site-footer').before(note);
    els.playToggle.disabled = true;
    els.requestBtn.disabled = true;
    document.querySelector('#playlist-link').setAttribute('aria-disabled', 'true');
    document.querySelector('#playlist-link').removeAttribute('href');
    const lastfmLink = document.querySelector('#lastfm-link');
    lastfmLink.hidden = true;
    lastfmLink.style.display = 'none';
  }
  bindPlayerControls();
  bindHistoryControls();
  bindRequestControls();
  bindLastfmControls(els, { onDisconnect: disconnectLastfm });
  await loadLastfmSession();

  const lastfmError = new URLSearchParams(window.location.search).get('lastfm_error');
  if (lastfmError) {
    renderLastfmStatus(els, 'Last.fm connection failed. Please try again.', true);
    window.history.replaceState({}, document.title, window.location.pathname);
  }

  await refreshNowPlaying();
  startPolling();
}

init();
