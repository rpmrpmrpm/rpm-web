// The frame on the cover of a generated list, with the list's name down its band. It is the desktop's own drawing
// (Assets/PlaylistOverlays/Frame.png, the file the phone apps ship too): a square that is black except for a
// window in the middle, with an empty band down the right-hand side. The black is painted in the list's border
// colour, the white in its text colour, and the name is set in the band. The window stays transparent, so the
// cover shows the list's picture through it. The desktop's CoverOverlay and the phone's PlaylistFrame do the same.

import drawingUrl from '../design/playlist-frame.png';
import type { Rgb } from '../design/palette.generated';
import type { ListLook } from './list-look';

// The size a frame is composed at, in pixels. One size for every place a cover is shown, so a list is composed
// once. The drawing itself is 800 pixels square.
export const FRAME_PIXELS = 512;

// Where the name goes, as fractions of the square, measured in the drawing (CoverOverlay.Letter, ListFrameMetrics).
// y counts down.
const NAME_CENTRE = 0.90813; // the middle of the band, across the square
const NAME_TOP = 0.0375; // where the lettering starts, down the square
const NAME_CROSS = 0.08; // how tall the lettering is across the band
const NAME_RUN = 0.8375; // how far the name may run before it reaches the app's own name in the corner

// Every cover's type size is measured on this string, not on the name, so all names on a shelf are one size.
const GAUGE = 'fg';

// One ink box: the outlines of the glyphs, not the line the font reserves. top and bottom are about the baseline,
// with y counting down, so both are negative for text that sits above the line.
export interface Ink {
  left: number;
  width: number;
  top: number;
  bottom: number;
}

export interface Lettering {
  size: number;
  // Where the pen goes from the anchor, in the turned frame.
  alongBand: number;
  acrossBand: number;
}

// The size of the name and where its baseline goes. Null when the font measures nothing, and the frame is then
// drawn with no name rather than a row of boxes.
export function lettering(name: string, edge: number, measure: (said: string, size: number) => Ink): Lettering | null {
  if (edge <= 0 || !name) return null;

  const band = edge * NAME_CROSS;
  let size = band;

  // A font with no Latin letters measures the gauge as nothing. The name sets the size instead.
  let gauged = measure(GAUGE, size);
  if (gauged.bottom - gauged.top <= 0) gauged = measure(name, size);
  if (gauged.bottom - gauged.top <= 0) return null;

  size *= band / (gauged.bottom - gauged.top);

  let ink = measure(name, size);
  if (ink.width <= 0) return null;

  // A long name is set smaller rather than run into the corner.
  if (ink.width > edge * NAME_RUN) {
    size *= (edge * NAME_RUN) / ink.width;
    ink = measure(name, size);
  }

  let across = measure(GAUGE, size);
  if (across.bottom - across.top <= 0) across = ink;

  return { size, alongBand: -ink.left, acrossBand: -((across.top + across.bottom) / 2) };
}

export const anchorOf = (edge: number) => ({ x: edge * NAME_CENTRE, y: edge * NAME_TOP });

// ── composing, in the browser ──

let drawing: Promise<HTMLImageElement | null> | null = null;
const inked = new Map<string, Promise<HTMLCanvasElement | null>>();
const composed = new Map<string, Promise<string | null>>();
const ready = new Map<string, string>();

const keyOf = (name: string, look: ListLook) => `${name}\u0000${look.border.join(',')}\u0000${look.text.join(',')}`;

// The frame composed before for this name and look, without waiting, so a cover drawn again shows it at once.
export const knownFrame = (name: string, look: ListLook): string | null => ready.get(keyOf(name, look)) ?? null;

// The lettered frame as a picture address, or null when the drawing did not load.
export function frameFor(name: string, look: ListLook): Promise<string | null> {
  const key = keyOf(name, look);
  let made = composed.get(key);
  if (!made) {
    made = compose(name, look)
      .then((address) => {
        if (address) ready.set(key, address);
        else composed.delete(key);
        return address;
      })
      .catch(() => {
        composed.delete(key);
        return null;
      });
    composed.set(key, made);
  }
  return made;
}

function loadDrawing(): Promise<HTMLImageElement | null> {
  drawing ??= (async () => {
    const image = new Image();
    image.src = drawingUrl;
    try {
      await image.decode();
      return image;
    } catch {
      drawing = null;
      return null;
    }
  })();
  return drawing;
}

// The drawing with its black and white replaced by a ramp between the two inks. The file is greyscale, so each
// pixel's grey says how far along the ramp it is, and the soft edges land in between. Alpha is kept, so the
// window stays transparent and its edge stays soft. Canvas pixels are not premultiplied, so the grey is read as it is.
function inkedDrawing(border: Rgb, text: Rgb): Promise<HTMLCanvasElement | null> {
  const key = `${border.join(',')}|${text.join(',')}`;
  let made = inked.get(key);
  if (!made) {
    made = loadDrawing().then((image) => {
      if (!image) return null;
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context || !canvas.width || !canvas.height) return null;
      context.drawImage(image, 0, 0);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
      const data = pixels.data;
      for (let at = 0; at < data.length; at += 4) {
        if (data[at + 3] === 0) continue;
        const along = data[at]! / 255;
        data[at] = Math.round(border[0] + (text[0] - border[0]) * along);
        data[at + 1] = Math.round(border[1] + (text[1] - border[1]) * along);
        data[at + 2] = Math.round(border[2] + (text[2] - border[2]) * along);
      }
      context.putImageData(pixels, 0, 0);
      return canvas;
    });
    inked.set(key, made);
  }
  return made;
}

const fontAt = (size: number) => `700 ${size}px Cabin, system-ui, sans-serif`;

async function compose(name: string, look: ListLook): Promise<string | null> {
  const frame = await inkedDrawing(look.border, look.text);
  if (!frame) return null;

  // The name is measured in Cabin Bold, so it must be loaded first or the size comes from a stand-in font.
  await document.fonts.load(fontAt(32), name).catch(() => []);

  const edge = FRAME_PIXELS;
  const canvas = document.createElement('canvas');
  canvas.width = edge;
  canvas.height = edge;
  const context = canvas.getContext('2d');
  if (!context) return null;

  context.imageSmoothingQuality = 'high';
  context.drawImage(frame, 0, 0, edge, edge);

  const measure = (said: string, size: number): Ink => {
    context.font = fontAt(size);
    const box = context.measureText(said);
    return { left: -box.actualBoundingBoxLeft, width: box.actualBoundingBoxLeft + box.actualBoundingBoxRight, top: -box.actualBoundingBoxAscent, bottom: box.actualBoundingBoxDescent };
  };

  const set = lettering(name, edge, measure);
  if (set) {
    // Turned clockwise, so the tops of the letters point to the outer edge, as in the drawing's own lettering.
    const anchor = anchorOf(edge);
    context.save();
    context.translate(anchor.x, anchor.y);
    context.rotate(Math.PI / 2);
    context.font = fontAt(set.size);
    context.textBaseline = 'alphabetic';
    context.fillStyle = `rgb(${look.text.join(' ')})`;
    context.fillText(name, set.alongBand, set.acrossBand);
    context.restore();
  }

  const blob = await new Promise<Blob | null>((done) => canvas.toBlob(done, 'image/png'));
  return blob ? URL.createObjectURL(blob) : null;
}
