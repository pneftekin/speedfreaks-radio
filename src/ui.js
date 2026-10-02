import { calcProgress, estimateElapsed, formatTime } from './api.js';

/** Cache DOM references once at startup. */
export function getElements() {
  return {
    playToggle: document.getElementById('play-toggle'),
    albumArt: document.getElementById('album-art'),
    songTitle: document.getElementById('song-title'),
    songArtist: document.getElementById('song-artist'),
    elapsedTime: document.getElementById('elapsed-time'),
    totalTime: document.getElementById('total-time'),
    progressBar: document.getElementById('progress-bar'),
    progressFill: document.getElementById('progress-fill'),
    listenerCount: document.getElementById('listener-count'),
    playerStatus: document.getElementById('player-status'),
    volumeSlider: document.getElementById('volume-slider'),
    volumeValue: document.getElementById('volume-value'),
    historyBtn: document.getElementById('song-history-btn'),
    historyDialog: document.getElementById('history-dialog'),
    historyClose: document.getElementById('history-close'),
    historyList: document.getElementById('history-list'),
    requestBtn: document.getElementById('request-song-btn'),
    requestDialog: document.getElementById('request-dialog'),
    requestClose: document.getElementById('request-close'),
    requestSearchForm: document.getElementById('request-search-form'),
    requestSearch: document.getElementById('request-search-input'),
    requestStatus: document.getElementById('request-status'),
    requestList: document.getElementById('request-list'),
    lastfmLink: document.getElementById('lastfm-link'),
    lastfmDisconnect: document.getElementById('lastfm-disconnect'),
    lastfmStatus: document.getElementById('lastfm-status'),
  };
}

/** Update now-playing display from normalized station data. */
export function renderNowPlaying(els, data, fetchedAt) {
  els.songTitle.textContent = data.title;
  els.songArtist.textContent = data.artist;

  if (data.artUrl) {
    els.albumArt.src = data.artUrl;
    els.albumArt.alt = `Album artwork for ${data.title} by ${data.artist}`;
  }

  els.listenerCount.textContent = `${data.listeners} listeners`;

  updateProgress(els, data.elapsed, data.duration, data.playedAt, fetchedAt);
}

/** Update progress bar and time labels (called on poll and local tick). */
export function updateProgress(els, serverElapsed, duration, playedAt, fetchedAt) {
  const elapsed = estimateElapsed(serverElapsed, playedAt, fetchedAt);
  const progress = calcProgress(elapsed, duration);

  els.elapsedTime.textContent = formatTime(elapsed);
  els.totalTime.textContent = formatTime(duration);
  els.progressFill.style.width = `${progress}%`;
  els.progressBar.setAttribute('aria-valuenow', String(Math.round(progress)));
}

export function renderPlayerState(els, { isPlaying, isBuffering, error }) {
  els.playToggle.classList.toggle('is-playing', isPlaying);
  els.playToggle.setAttribute('aria-pressed', String(isPlaying));
  els.playToggle.setAttribute(
    'aria-label',
    isPlaying ? 'Pause live stream' : 'Play live stream',
  );

  els.playerStatus.classList.toggle('is-error', Boolean(error));

  if (error) {
    els.playerStatus.textContent = error;
  } else if (isBuffering) {
    els.playerStatus.textContent = 'buffering…';
  } else if (isPlaying) {
    els.playerStatus.textContent = 'live';
  } else {
    els.playerStatus.textContent = '';
  }
}

export function renderVolume(els, percent) {
  els.volumeSlider.value = String(percent);
  els.volumeValue.textContent = `${percent}%`;
}

export function renderHistory(els, history) {
  els.historyList.replaceChildren();

  if (!history.length) {
    const empty = document.createElement('li');
    empty.className = 'history-item';
    empty.textContent = 'No history available.';
    els.historyList.appendChild(empty);
    return;
  }

  for (const item of history) {
    const li = document.createElement('li');
    li.className = 'history-item';

    const img = document.createElement('img');
    img.className = 'history-item__art';
    img.src = item.artUrl || '';
    img.alt = '';
    img.width = 48;
    img.height = 48;
    if (!item.artUrl) img.hidden = true;

    const info = document.createElement('div');

    const title = document.createElement('p');
    title.className = 'history-item__title';
    title.textContent = item.title;

    const artist = document.createElement('p');
    artist.className = 'history-item__artist';
    artist.textContent = item.artist;

    info.append(title, artist);
    li.append(img, info);
    els.historyList.appendChild(li);
  }
}

export function openHistory(els) {
  if (typeof els.historyDialog.showModal === 'function') {
    els.historyDialog.showModal();
  }
}

export function closeHistory(els) {
  els.historyDialog.close();
}

export function openRequestModal(els) {
  els.requestDialog.showModal();
  els.requestSearch.focus();
}

export function closeRequestModal(els) {
  els.requestDialog.close();
  els.requestBtn.focus();
}

export function renderRequestStatus(els, message, state = '') {
  els.requestStatus.textContent = message;
  els.requestStatus.className = `request-status${state ? ` is-${state}` : ''}`;
}

export function renderRequestList(els, tracks, query, onRequest) {
  const normalizedQuery = query.trim().toLowerCase();
  const filteredTracks = tracks.filter((track) =>
    `${track.artist} ${track.title}`.toLowerCase().includes(normalizedQuery),
  );

  els.requestList.replaceChildren();

  if (!filteredTracks.length) {
    renderRequestStatus(els, normalizedQuery ? 'No matching songs.' : 'No songs available for request.');
    return;
  }

  renderRequestStatus(els, `${filteredTracks.length} songs available`);
  for (const track of filteredTracks) {
    const item = document.createElement('li');
    item.className = 'request-item';

    const info = document.createElement('div');
    const title = document.createElement('p');
    title.className = 'request-item__title';
    title.textContent = track.title;
    const artist = document.createElement('p');
    artist.className = 'request-item__artist';
    artist.textContent = track.artist;
    info.append(title, artist);

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'request-item__button';
    button.textContent = 'request';
    button.setAttribute('aria-label', `Request ${track.title} by ${track.artist}`);
    button.addEventListener('click', () => onRequest(track, button));

    item.append(info, button);
    els.requestList.appendChild(item);
  }
}

export function renderLastfmState(els, state) {
  if (state.connected) {
    els.lastfmLink.textContent = `last.fm · @${state.username} ✓`;
    els.lastfmLink.classList.add('is-connected');
    els.lastfmLink.setAttribute('aria-label', `Connected to Last.fm as ${state.username}`);
    els.lastfmDisconnect.hidden = false;
  } else {
    els.lastfmLink.replaceChildren();
    const icon = document.createElement('svg');
    icon.className = 'icon';
    icon.setAttribute('viewBox', '0 0 16 16');
    icon.setAttribute('aria-hidden', 'true');
    icon.innerHTML = '<path d="M8 2l1.5 3.5L13 6.5l-2.5 2.5.5 3.5L8 10.5 5 12.5l.5-3.5L3 6.5l3.5-1L8 2z" fill="none" stroke="currentColor" stroke-width="1" />';
    els.lastfmLink.append(icon, 'connect last.fm');
    els.lastfmLink.classList.remove('is-connected');
    els.lastfmLink.setAttribute('aria-label', 'Connect Last.fm account');
    els.lastfmDisconnect.hidden = true;
  }
}

export function renderLastfmStatus(els, message, isError = false) {
  els.lastfmStatus.textContent = message;
  els.lastfmStatus.classList.toggle('is-error', isError);
}

export function bindLastfmControls(els, { onDisconnect }) {
  els.lastfmDisconnect.addEventListener('click', onDisconnect);
}