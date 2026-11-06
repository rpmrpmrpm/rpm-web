// Runs the chain away from the page, so decoding never holds up the interface.

import createRpmMedia from '/media/rpm-media.js';
import { Chain, FileSource, UrlSource } from './chain.js';

const media = await createRpmMedia();
let chain = null;

function sourceOf(track) {
  return track.file ? new FileSource(track.file) : new UrlSource(track.url);
}

function send(result) {
  const message = {
    type: 'bytes',
    bytes: result.bytes,
    ended: result.ended,
    boundaries: chain.boundaries,
    failures: chain.failures,
  };
  postMessage(message, [result.bytes.buffer]);
}

const handlers = {
  start({ tracks }) {
    if (chain) chain.close();
    chain = new Chain(media);
    tracks.forEach((track) => chain.add({ ...track, makeSource: () => sourceOf(track) }));
    // The init segment, on its own, so the page can make its buffer before any audio arrives.
    send({ bytes: chain.take(), ended: false });
  },

  render({ seconds }) {
    const started = performance.now();
    const result = chain.render(seconds);
    postMessage({ type: 'speed', seconds, took: performance.now() - started });
    send(result);
  },

  // A key press: the queue moves on from here, and the stream carries on at a later time.
  next() {
    chain.stopCurrent();
    postMessage({ type: 'cut', at: chain.framesWritten / 44100 });
  },

  seek({ seconds }) {
    if (chain.current) {
      chain.seekCurrent(seconds);
      postMessage({ type: 'cut', at: chain.framesWritten / 44100 });
    }
  },
};

onmessage = ({ data }) => {
  try {
    handlers[data.type](data);
  } catch (error) {
    postMessage({ type: 'error', said: String(error) });
  }
};

postMessage({ type: 'ready' });
