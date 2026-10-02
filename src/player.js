import { STREAM_URL } from './api.js';

/**
 * Native HTML Audio wrapper for the live radio stream.
 */
export class RadioPlayer {
  constructor() {
    this.audio = new Audio();
    this.audio.preload = 'none';
    this.audio.crossOrigin = 'anonymous';
    this.audio.src = STREAM_URL;

    /** @type {((state: PlayerState) => void) | null} */
    this.onStateChange = null;

    this.audio.addEventListener('playing', () => this.#emit());
    this.audio.addEventListener('pause', () => this.#emit());
    this.audio.addEventListener('waiting', () => this.#emit());
    this.audio.addEventListener('error', () => this.#emit());

    this.audio.volume = 0.64;
  }

  get isPlaying() {
    return !this.audio.paused && !this.audio.ended;
  }

  get isBuffering() {
    return this.isPlaying && this.audio.readyState < HTMLMediaElement.HAVE_FUTURE_DATA;
  }

  get errorMessage() {
    const err = this.audio.error;
    if (!err) return null;

    const messages = {
      [MediaError.MEDIA_ERR_ABORTED]: 'Playback aborted.',
      [MediaError.MEDIA_ERR_NETWORK]: 'Network error — check your connection.',
      [MediaError.MEDIA_ERR_DECODE]: 'Stream decode error.',
      [MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED]: 'Stream format not supported.',
    };

    return messages[err.code] || 'Playback error.';
  }

  async play() {
    try {
      await this.audio.play();
    } catch (err) {
      if (err.name === 'NotAllowedError') {
        throw new Error('Click play to start listening.');
      }
      throw err;
    }
  }

  pause() {
    this.audio.pause();
  }

  toggle() {
    if (this.isPlaying) {
      this.pause();
    } else {
      return this.play();
    }
  }

  setVolume(percent) {
    this.audio.volume = Math.min(1, Math.max(0, percent / 100));
    this.#emit();
  }

  getVolumePercent() {
    return Math.round(this.audio.volume * 100);
  }

  #emit() {
    this.onStateChange?.({
      isPlaying: this.isPlaying,
      isBuffering: this.isBuffering,
      volume: this.getVolumePercent(),
      error: this.errorMessage,
    });
  }
}

/** @typedef {{ isPlaying: boolean, isBuffering: boolean, volume: number, error: string | null }} PlayerState */

export function createPlayer() {
  return new RadioPlayer();
}