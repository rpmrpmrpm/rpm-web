// The test page for the audio chain. It answers three questions on a real device: does the browser
// accept FLAC in a MediaSource, does the queue carry on through track changes on a locked screen, and
// do the lock screen controls work. Everything that happens is written to a log that survives a
// reload, because a locked phone cannot be watched.

import { STREAM_TYPES } from './chain.js';

const audio = document.getElementById('audio');
const params = new URLSearchParams(location.search);
const element = (id) => document.getElementById(id);

const small = /Mobi|Android|iPhone/.test(navigator.userAgent);
const AHEAD_SECONDS = small ? 90 : 12;
const RENDER_SECONDS = 4;
const LOG_KEY = 'rpm-proof-log';
const OPEN_DURATION = 7 * 24 * 3600;

const MediaSourceType = window.ManagedMediaSource ?? window.MediaSource;
const managed = MediaSourceType === window.ManagedMediaSource && !!window.ManagedMediaSource;

let lines = [];
try {
  lines = JSON.parse(localStorage.getItem(LOG_KEY) ?? '[]');
} catch {
  lines = [];
}

function log(text, kind) {
  const hidden = document.hidden ? ' [hidden]' : '';
  const line = `${new Date().toLocaleTimeString()}${hidden} ${text}`;
  lines.push(line);
  lines = lines.slice(-200);
  try {
    localStorage.setItem(LOG_KEY, JSON.stringify(lines));
  } catch {
    // The log still shows on the page.
  }
  element('log').textContent = [...lines].reverse().join('\n');
  if (kind === 'fail') console.error(line);
}

const streamType = STREAM_TYPES.find((type) => MediaSourceType?.isTypeSupported?.(type));

function facts() {
  const supported = !!streamType;
  element('facts').textContent =
    `${managed ? 'ManagedMediaSource' : 'MediaSource'}: ${MediaSourceType ? 'yes' : 'NO'}. ` +
    `FLAC in MP4: ${supported ? 'yes' : 'NO'}. ` +
    `audioSession: ${navigator.audioSession ? 'yes' : 'no'}. ` +
    `mediaSession: ${'mediaSession' in navigator ? 'yes' : 'no'}.`;
  return supported;
}

class Player {
  worker = null;
  source = null;
  buffer = null;
  pending = [];
  boundaries = [];
  shown = -1;
  ended = false;
  rendering = false;
  failuresShown = 0;
  crossings = 0;
  speed = [];

  constructor() {
    audio.addEventListener('timeupdate', () => this.tick());
    // A playhead with nothing to play sends no timeupdate, so these have to ask for more.
    audio.addEventListener('waiting', () => this.pull());
    audio.addEventListener('seeking', () => this.pull());
    for (const name of ['pause', 'play', 'playing', 'waiting', 'stalled', 'error', 'ended', 'suspend']) {
      audio.addEventListener(name, () => {
        if (name === 'suspend') return;
        log(`audio: ${name}${name === 'error' ? ` ${audio.error?.message ?? ''}` : ''}`, name === 'error' ? 'fail' : undefined);
      });
    }
    document.addEventListener('visibilitychange', () => log(`page ${document.hidden ? 'hidden' : 'visible'}`));
  }

  start(tracks) {
    this.stop();
    this.tracks = tracks;
    this.source = new MediaSourceType();
    if (managed) {
      this.source.addEventListener('startstreaming', () => { log('startstreaming'); this.pull(); });
      this.source.addEventListener('endstreaming', () => log('endstreaming'));
    }
    audio.disableRemotePlayback = true;
    audio.src = URL.createObjectURL(this.source);
    this.source.addEventListener('sourceopen', () => this.opened(), { once: true });
    this.controls();
  }

  stop() {
    if (this.worker) this.worker.terminate();
    this.worker = null;
    this.buffer = null;
    this.pending = [];
    this.boundaries = [];
    this.shown = -1;
    this.ended = false;
    this.rendering = false;
    this.failuresShown = 0;
    this.crossings = 0;
  }

  opened() {
    // The length of the stream is not known until the queue ends. A browser limits a seek to the
    // duration, so a duration that follows the buffer would stop a key press from jumping ahead.
    this.source.duration = OPEN_DURATION;
    this.buffer = this.source.addSourceBuffer(streamType);
    this.buffer.addEventListener('updateend', () => this.appendNext());
    this.buffer.addEventListener('error', () => log('buffer error', 'fail'));

    this.worker = new Worker(new URL('./media-worker.js', import.meta.url), { type: 'module' });
    this.worker.onerror = (event) => log(`worker: ${event.message}`, 'fail');
    this.worker.onmessage = ({ data }) => this.received(data);
  }

  received(data) {
    switch (data.type) {
      case 'ready':
        this.worker.postMessage({ type: 'start', tracks: this.tracks });
        break;
      case 'bytes':
        this.rendering = false;
        this.pending.push(data.bytes);
        this.boundaries = data.boundaries;
        this.ended = data.ended;
        for (const failure of data.failures.slice(this.failuresShown)) log(`failed: ${failure.name}: ${failure.said}`, 'fail');
        this.failuresShown = data.failures.length;
        this.appendNext();
        break;
      case 'cut':
        this.cutTo(data.at);
        break;
      case 'speed':
        this.speed.push(data.seconds / (data.took / 1000));
        break;
      case 'error':
        this.rendering = false;
        log(`worker: ${data.said}`, 'fail');
        break;
    }
  }

  appendNext() {
    if (!this.buffer || this.buffer.updating) return;

    if (this.pending.length > 0) {
      try {
        this.buffer.appendBuffer(this.pending[0]);
        this.pending.shift();
      } catch (error) {
        if (error.name !== 'QuotaExceededError') {
          log(`append: ${error.name} ${error.message}`, 'fail');
          return;
        }
        // The browser holds no more. Played audio goes, and the same bytes are tried again.
        const keepFrom = audio.currentTime - 2;
        if (this.buffer.buffered.length > 0 && keepFrom > this.buffer.buffered.start(0)) {
          log(`quota: removing played audio up to ${keepFrom.toFixed(0)} s`);
          this.buffer.remove(0, keepFrom);
        }
      }
      return;
    }

    if (this.ended && this.source.readyState === 'open') {
      this.source.endOfStream();
      return;
    }
    this.pull();
  }

  bufferEnd() {
    const ranges = this.buffer?.buffered;
    return ranges && ranges.length > 0 ? ranges.end(ranges.length - 1) : 0;
  }

  // The worker makes only what the buffer has room for, so the stream sets the pace.
  pull() {
    if (!this.worker || !this.buffer || this.rendering || this.ended) return;
    if (this.pending.length > 0 || this.buffer.updating) return;
    if (managed && this.source.streaming === false && this.bufferEnd() - audio.currentTime > 10) return;
    if (this.bufferEnd() - audio.currentTime >= AHEAD_SECONDS) return;

    // Each append that lands comes back here through updateend, so a seek far ahead fills up to it.
    this.rendering = true;
    this.worker.postMessage({ type: 'render', seconds: RENDER_SECONDS });
  }

  // A key press. The stream's clock has moved on, so the buffer ahead goes and playback jumps to the
  // time the new audio starts at.
  cutTo(at) {
    this.ended = false;
    this.waitingAt = at;
    const clear = () => {
      this.buffer.remove(audio.currentTime, Infinity);
      this.buffer.addEventListener('updateend', () => {
        audio.currentTime = at;
        this.pull();
      }, { once: true });
    };
    if (this.buffer.updating) this.buffer.addEventListener('updateend', clear, { once: true });
    else clear();
  }

  currentIndex() {
    let index = -1;
    for (let i = 0; i < this.boundaries.length; i++) {
      if (this.boundaries[i].at <= audio.currentTime + 0.01) index = i;
    }
    return index;
  }

  tick() {
    this.pull();

    const index = this.currentIndex();
    if (index < 0) return;
    const track = this.boundaries[index];

    if (index !== this.shown) {
      if (this.shown >= 0) {
        this.crossings += 1;
        log(`crossed into ${track.name} (${this.crossings})`);
      }
      this.shown = index;
      element('title').textContent = track.name;
      if ('mediaSession' in navigator) {
        navigator.mediaSession.metadata = new MediaMetadata({ title: track.name, artist: 'rpm test', album: 'Playback test' });
      }
    }

    const at = audio.currentTime - track.at + (track.offset ?? 0);
    element('where').textContent =
      `${at.toFixed(1)} s, stream ${audio.currentTime.toFixed(1)} s, buffered to ${this.bufferEnd().toFixed(1)} s`;

    if ('mediaSession' in navigator && navigator.mediaSession.setPositionState) {
      const next = this.boundaries[index + 1];
      const duration = (next ? next.at : Math.max(this.bufferEnd(), audio.currentTime + 1)) - track.at;
      try {
        navigator.mediaSession.setPositionState({ duration, position: Math.min(at, duration), playbackRate: 1 });
        navigator.mediaSession.playbackState = audio.paused ? 'paused' : 'playing';
      } catch {
        // A bad value is not worth stopping for.
      }
    }
  }

  next() {
    this.worker?.postMessage({ type: 'next' });
  }

  controls() {
    if (!('mediaSession' in navigator)) return;
    const session = navigator.mediaSession;
    session.setActionHandler('play', () => { log('lock screen: play'); audio.play(); });
    session.setActionHandler('pause', () => { log('lock screen: pause'); audio.pause(); });
    session.setActionHandler('nexttrack', () => { log('lock screen: next'); this.next(); });
    session.setActionHandler('previoustrack', () => { log('lock screen: previous'); });
  }

  state() {
    return {
      currentTime: audio.currentTime,
      paused: audio.paused,
      bufferEnd: this.bufferEnd(),
      boundaries: this.boundaries,
      crossings: this.crossings,
      shown: this.shown,
      ended: this.ended,
      speed: this.speed,
      error: audio.error?.message ?? null,
      log: lines,
    };
  }
}

const player = new Player();
window.proof = { player, state: () => player.state() };

function album(set) {
  const extension = set === 'flac' ? 'flac' : set === 'mp3' ? 'mp3' : 'm4a';
  // Fourteen tracks, the album twice, take almost six minutes. The buffer holds a minute and a half on
  // a phone, so the queue can only finish if the page keeps working while the phone is locked.
  return [1, 2, 3, 4, 5, 6, 7, 1, 2, 3, 4, 5, 6, 7].map((n, index) => ({
    name: `${set} ${index + 1}.${extension}`,
    url: new URL(`./tracks/${set}-${n}.${extension}`, location.href).href,
    gain: 1,
  }));
}

async function play(tracks) {
  if (navigator.audioSession) navigator.audioSession.type = 'playback';
  log(`starting ${tracks.length} tracks`);
  player.start(tracks);
  // play() has to run inside the click. The audio arrives after it.
  try {
    await audio.play();
  } catch (error) {
    log(`play: ${error.name} ${error.message}`, 'fail');
  }
}

element('play').addEventListener('click', () => {
  if (player.worker && audio.paused) audio.play();
  else if (player.worker) audio.pause();
  else play(album(element('set').value));
});
element('next').addEventListener('click', () => player.next());
element('prev').addEventListener('click', () => log('previous is not part of this test'));
element('forward').addEventListener('click', () => {
  const index = player.currentIndex();
  const track = player.boundaries[index];
  if (track) player.worker.postMessage({ type: 'seek', seconds: audio.currentTime - track.at + (track.offset ?? 0) + 30 });
});
element('clear').addEventListener('click', () => { lines = []; log('log cleared'); });
element('pick').addEventListener('click', () => element('files').click());
element('files').addEventListener('change', (event) => {
  const tracks = [...event.target.files].map((file) => ({ name: file.name, file, gain: 1 }));
  if (tracks.length) play(tracks);
});

const supported = facts();
if (!supported) log('this browser did not accept the stream type', 'fail');

// Without a person: starts muted, which a browser allows, and sends the result to the test server.
if (params.get('auto')) {
  audio.muted = true;
  const seconds = Number(params.get('auto'));
  player.start(album(params.get('set') ?? 'flac'));
  audio.play().catch((error) => log(`play: ${error.name}`, 'fail'));
  setTimeout(() => {
    fetch('/report', {
      method: 'POST',
      body: JSON.stringify({ userAgent: navigator.userAgent, supported, ...player.state() }),
    });
  }, seconds * 1000);
}
