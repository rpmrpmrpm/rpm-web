// The three tracks rpm ships, for someone with no music to hand, as the desktop's setup offers them. They are
// fetched from the app's own files and then go through the ordinary import, as files the listener picked would:
// the same tags, the same review, the same upload. The tags and the cover are inside each file.
//
// Each goes in a folder of its own, because the import reads a folder as one record. Three in one folder would
// be taken for one album.

import type { PickedFile } from './queue';

export const STARTER_FILES = ['starter-connect.mp3', 'starter-gymnopedie.ogg', 'starter-moonlight.ogg'] as const;

const TYPES: Record<string, string> = { mp3: 'audio/mpeg', ogg: 'audio/ogg' };

// The three as picked files, or an error when any of them could not be fetched. A part of the set is not offered:
// "three tracks from rpm" with one missing would look like a fault in the import.
export async function starterMusic(base: string, fetcher: typeof fetch): Promise<PickedFile[]> {
  return Promise.all(
    STARTER_FILES.map(async (name) => {
      const response = await fetcher(`${base}starter/${name}`);
      if (!response.ok) throw new Error(`starter ${name}: HTTP ${response.status}`);
      const extension = name.slice(name.lastIndexOf('.') + 1);
      const file = new File([await response.blob()], name, { type: TYPES[extension] ?? '' });
      return { file, path: `${name.slice(0, name.lastIndexOf('.'))}/${name}` };
    }),
  );
}
