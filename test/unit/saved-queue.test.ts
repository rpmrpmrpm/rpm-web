import { describe, expect, it } from 'vitest';

import { pickedFromHandles } from '../../src/import/pick';
import { ImportQueue, type ImportRow, type PickedFile } from '../../src/import/queue';
import { QueueKeeper, type QueueStore, type SavedQueue } from '../../src/import/saved-queue';

const picked = (path: string, size = 4): PickedFile => ({ file: new File(['x'.repeat(size)], path.split('/').pop()!), path });

function ready(queue: ImportQueue, files: PickedFile[]): ImportRow[] {
  const rows = queue.add(files);
  for (const row of rows) queue.read(row, { Title: `file ${row.path}`, Artist: 'From the file' }, false);
  return rows;
}

// A store held in memory, and a timer that runs when told.
function stage() {
  const held = new Map<string, SavedQueue>();
  const store: QueueStore = {
    read: async (userId) => held.get(userId) ?? null,
    write: async (userId, saved) => void held.set(userId, structuredClone(saved)),
  };
  let timer: (() => void) | null = null;
  const queue = new ImportQueue();
  const keeper = new QueueKeeper(queue, store, (run) => {
    timer = run;
  });
  const flush = async () => {
    timer?.();
    timer = null;
    await Promise.resolve();
    await Promise.resolve();
  };
  return { held, store, queue, keeper, flush };
}

// The same account back on a new page.
async function returning(store: QueueStore, userId = 'user') {
  const queue = new ImportQueue();
  const keeper = new QueueKeeper(queue, store, () => {});
  await keeper.open(userId);
  return { queue, keeper };
}

describe('the queue between visits', () => {
  it('brings back what was edited when the same file is added again', async () => {
    const { store, queue, keeper, flush } = stage();
    await keeper.open('user');
    const [row] = ready(queue, [picked('Album/01.flac')]);
    queue.applyTags([row!], { Title: 'Edited' });
    queue.setTick(row!, false);
    queue.setCover([row!], { bytes: new Uint8Array([7]), mime: 'image/png' });
    queue.setDisc([row!], { bytes: new Uint8Array([8]), mime: 'image/webp' });
    await flush();

    const next = await returning(store);
    expect(next.queue.waiting.size).toBe(1);
    const [back] = ready(next.queue, [picked('Album/01.flac')]);
    expect(back!.tags.Title).toBe('Edited');
    expect(back!.ticked).toBe(false);
    expect(back!.cover?.mime).toBe('image/png');
    expect(back!.disc?.mime).toBe('image/webp');
    expect(next.queue.waiting.size).toBe(0);
  });

  it('keeps a name that came from the file name marked as a guess', async () => {
    const { store, queue, keeper, flush } = stage();
    await keeper.open('user');
    const [row] = ready(queue, [picked('Avicii - Wake Me Up.flac')]);
    queue.tagsFromFilename([row!], '{artist} - {title}');
    await flush();

    const next = await returning(store);
    const [back] = ready(next.queue, [picked('Avicii - Wake Me Up.flac')]);
    expect(back!.guessed).toBe(true);
  });

  it('reads a file of another size as another file', async () => {
    const { store, queue, keeper, flush } = stage();
    await keeper.open('user');
    const [row] = ready(queue, [picked('Album/01.flac', 4)]);
    queue.applyTags([row!], { Title: 'Edited' });
    await flush();

    const next = await returning(store);
    const [back] = ready(next.queue, [picked('Album/01.flac', 5)]);
    expect(back!.tags.Title).toBe('file Album/01.flac');
    expect(next.queue.waiting.size).toBe(1);
  });

  it('puts rows back in the order they were arranged in', async () => {
    const { store, queue, keeper, flush } = stage();
    await keeper.open('user');
    const rows = ready(queue, [picked('Album/01.flac'), picked('Album/02.flac'), picked('Album/03.flac')]);
    queue.move([rows[2]!], rows[0]!);
    await flush();

    const next = await returning(store);
    const back = ready(next.queue, [picked('Album/01.flac'), picked('Album/02.flac'), picked('Album/03.flac')]);
    expect(back.map((row) => row.path)).toEqual(['Album/03.flac', 'Album/01.flac', 'Album/02.flac']);
  });

  it('keeps the rows that have not come back yet', async () => {
    const { store, queue, keeper, flush } = stage();
    await keeper.open('user');
    ready(queue, [picked('Album/01.flac'), picked('Album/02.flac')]);
    await flush();

    const second = stage();
    second.held.set('user', (await store.read('user'))!);
    await second.keeper.open('user');
    ready(second.queue, [picked('Album/01.flac')]);
    await second.flush();

    const third = await returning(second.store);
    expect([...third.queue.waiting.values()].map((row) => row.path).sort()).toEqual(['Album/01.flac', 'Album/02.flac']);
  });

  it.each(['done', 'known', 'unreadable', 'refused'] as const)('does not keep a row that is %s', async (state) => {
    const { store, queue, keeper, flush } = stage();
    await keeper.open('user');
    const [row] = ready(queue, [picked('Album/01.flac')]);
    row!.state = state;
    queue.changed();
    await flush();

    expect((await returning(store)).queue.waiting.size).toBe(0);
  });

  it.each(['failed', 'waiting', 'working'] as const)('keeps a row that is %s, because its import did not finish', async (state) => {
    const { store, queue, keeper, flush } = stage();
    await keeper.open('user');
    const [row] = ready(queue, [picked('Album/01.flac')]);
    row!.state = state;
    queue.changed();
    await flush();

    expect((await returning(store)).queue.waiting.size).toBe(1);
  });

  it('belongs to one account', async () => {
    const { store, queue, keeper, flush } = stage();
    await keeper.open('user');
    ready(queue, [picked('Album/01.flac')]);
    await flush();

    expect((await returning(store, 'someone else')).queue.waiting.size).toBe(0);
  });

  it('forgets what the person lets go of, for good', async () => {
    const { store, queue, keeper, flush } = stage();
    await keeper.open('user');
    ready(queue, [picked('Album/01.flac')]);
    await flush();

    const next = await returning(store);
    await next.keeper.forget();
    expect(next.queue.waiting.size).toBe(0);
    expect((await returning(store)).queue.waiting.size).toBe(0);
  });

  it('saves nothing before an account has opened it', async () => {
    const { held, queue, flush } = stage();
    ready(queue, [picked('Album/01.flac')]);
    await flush();
    expect(held.size).toBe(0);
  });

  it('stops saving for an account that signed out', async () => {
    const { held, queue, keeper, flush } = stage();
    await keeper.open('user');
    keeper.close();
    ready(queue, [picked('Album/01.flac')]);
    await flush();
    expect(held.size).toBe(0);
  });

  it('takes a queue that cannot be read as an empty one, and still imports', async () => {
    const queue = new ImportQueue();
    const broken: QueueStore = { read: () => Promise.reject(new Error('blocked')), write: () => Promise.reject(new Error('blocked')) };
    const keeper = new QueueKeeper(queue, broken, (run) => run());
    await keeper.open('user');
    expect(() => ready(queue, [picked('Album/01.flac')])).not.toThrow();
    await Promise.resolve();
    expect(queue.rows).toHaveLength(1);
  });

  it('keeps the folders it may open again, until nothing depends on them', async () => {
    const { store, queue, keeper, flush } = stage();
    await keeper.open('user');
    keeper.addSources([{ name: 'Album' } as FileSystemHandle]);
    ready(queue, [picked('Album/01.flac')]);
    await flush();

    const next = await returning(store);
    expect(next.keeper.sources).toHaveLength(1);
    await next.keeper.forget();
    expect((await returning(store)).keeper.sources).toHaveLength(0);
  });
});

describe('a folder opened again', () => {
  const file = (name: string, text = 'audio') => ({ kind: 'file', name, getFile: async () => new File([text], name) }) as unknown as FileSystemFileHandle;
  const folder = (name: string, ...children: FileSystemHandle[]) =>
    ({
      kind: 'directory',
      name,
      async *values() {
        yield* children;
      },
    }) as unknown as FileSystemDirectoryHandle;

  it('reads paths as a picked folder has them, from the folder name down', async () => {
    const found = await pickedFromHandles([folder('Album', file('01.flac'), folder('Disc 2', file('02.flac')))]);
    expect(found.map((one) => one.path).sort()).toEqual(['Album/01.flac', 'Album/Disc 2/02.flac']);
  });

  it('reads a file that was dropped on its own by its name', async () => {
    const found = await pickedFromHandles([file('01.flac')]);
    expect(found.map((one) => one.path)).toEqual(['01.flac']);
  });
});
