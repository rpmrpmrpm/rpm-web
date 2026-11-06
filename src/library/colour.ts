// The colour of a cover, for the room behind the panes and for the album drawer: the brightest colour
// with real saturation, or the mean where a cover has none.

export interface Colour {
  r: number;
  g: number;
  b: number;
}

const SIZE = 24;

export function pickColour(pixels: Uint8ClampedArray): Colour {
  let best: Colour | null = null;
  let bestScore = 0;
  const mean = { r: 0, g: 0, b: 0 };
  const count = pixels.length / 4;

  for (let i = 0; i < pixels.length; i += 4) {
    const r = pixels[i]!;
    const g = pixels[i + 1]!;
    const b = pixels[i + 2]!;
    mean.r += r / count;
    mean.g += g / count;
    mean.b += b / count;

    const high = Math.max(r, g, b);
    const low = Math.min(r, g, b);
    const saturation = high === 0 ? 0 : (high - low) / high;
    const score = saturation * Math.min(high, 200);
    if (saturation > 0.25 && high > 60 && score > bestScore) {
      bestScore = score;
      best = { r, g, b };
    }
  }
  return best ?? { r: Math.round(mean.r), g: Math.round(mean.g), b: Math.round(mean.b) };
}

// Read through an image, because the site's content policy allows a blob address for a picture and
// not for a fetch.
export async function colourOf(url: string): Promise<Colour | null> {
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const context = new OffscreenCanvas(SIZE, SIZE).getContext('2d')!;
    context.drawImage(image, 0, 0, SIZE, SIZE);
    return pickColour(context.getImageData(0, 0, SIZE, SIZE).data);
  } catch {
    return null;
  }
}

export const css = ({ r, g, b }: Colour, scale = 1): string =>
  `rgb(${Math.round(r * scale)} ${Math.round(g * scale)} ${Math.round(b * scale)})`;

// The vertical ramp of an album band: 0.62 at the top, 0.51 in the middle, 0.40 at the foot.
export const bandGradient = (colour: Colour): string =>
  `linear-gradient(180deg, ${css(colour, 0.62)} 0%, ${css(colour, 0.51)} 50%, ${css(colour, 0.4)} 100%)`;
