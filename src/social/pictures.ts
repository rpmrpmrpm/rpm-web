// Makes a picked picture small enough for the server, as the desktop and the phones do: JPEG, cut at the centre to
// the shape it is shown in, and never larger than the picture itself. The quality is lowered until it fits under
// the limit. The server keeps what it is given and never re-encodes it.

export const PHOTO = { wide: 512, high: 512, limit: 500_000 };
export const BANNER = { wide: 1500, high: 500, limit: 1_900_000 };

const QUALITIES = [0.85, 0.7, 0.55, 0.4];

// The size drawn: the shape asked for, made smaller as a whole when the picture is smaller than it.
export function drawnSize(width: number, height: number, wide: number, high: number): { wide: number; high: number } {
  const fill = Math.max(wide / width, high / height);
  return fill > 1 ? { wide: Math.max(1, Math.floor(wide / fill)), high: Math.max(1, Math.floor(high / fill)) } : { wide, high };
}

// The JPEG, or null when the picture does not decode or does not fit under the limit at the lowest quality.
export async function preparedPicture(file: Blob, shape: { wide: number; high: number; limit: number }): Promise<Uint8Array | null> {
  let picture: ImageBitmap;
  try {
    picture = await createImageBitmap(file);
  } catch {
    return null;
  }
  try {
    const out = drawnSize(picture.width, picture.height, shape.wide, shape.high);
    const scale = Math.max(out.wide / picture.width, out.high / picture.height);
    const cropWide = out.wide / scale;
    const cropHigh = out.high / scale;
    const canvas = new OffscreenCanvas(out.wide, out.high);
    const context = canvas.getContext('2d')!;
    context.imageSmoothingQuality = 'high';
    context.drawImage(picture, (picture.width - cropWide) / 2, (picture.height - cropHigh) / 2, cropWide, cropHigh, 0, 0, out.wide, out.high);
    for (const quality of QUALITIES) {
      const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality });
      if (blob.size <= shape.limit) return new Uint8Array(await blob.arrayBuffer());
    }
    return null;
  } finally {
    picture.close();
  }
}
