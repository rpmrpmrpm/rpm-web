<script lang="ts">
  // The pictures of what is ticked: the cover the files have now, one found by name, or one chosen from
  // disk, and the same for the label of the disc.
  import { importer, importQueue } from '../../app';
  import type { CoverKind, PickedPicture } from '../../import/cover-search';
  import type { ImportRow } from '../../import/queue';
  import { text } from '../../strings/loc';
  import ArtWell from './ArtWell.svelte';
  import CoverFinder from './CoverFinder.svelte';

  let { rows, version }: { rows: ImportRow[]; version: number } = $props();

  let cover = $state<string | null>(null);
  let disc = $state<string | null>(null);
  let finding = $state<CoverKind | null>(null);

  const first = $derived(rows[0] ?? null);
  const hasCover = $derived.by(() => {
    void version;
    return !!first?.cover;
  });
  const hasDisc = $derived.by(() => {
    void version;
    return !!first?.disc;
  });

  const addressOf = (picture: PickedPicture) => URL.createObjectURL(new Blob([picture.bytes as BlobPart], { type: picture.mime }));

  $effect(() => {
    void version;
    const row = first;
    let current = true;
    let address: string | null = null;
    void (row ? importer.coverOf(row).catch(() => null) : Promise.resolve(null)).then((picture) => {
      if (!current) return;
      address = picture ? addressOf(picture) : null;
      cover = address;
    });
    return () => {
      current = false;
      if (address) URL.revokeObjectURL(address);
    };
  });

  $effect(() => {
    void version;
    const picture = first?.disc;
    const address = picture ? addressOf(picture) : null;
    disc = address;
    return () => {
      if (address) URL.revokeObjectURL(address);
    };
  });

  function found(picture: PickedPicture, label: PickedPicture | null) {
    if (finding === 'disc') importQueue.setDisc(rows, picture);
    else importQueue.setCover(rows, picture);
    if (label) importQueue.setDisc(rows, label);
    finding = null;
  }
</script>

<div class="wells">
  <ArtWell
    label={text('Queue_TagPanelCover')}
    shown={cover}
    chosen={hasCover}
    finder={text('CoverSearch_Heading')}
    onTake={(picture) => importQueue.setCover(rows, picture)}
    onFind={() => (finding = 'cover')}
    onRemove={() => importQueue.setCover(rows, null)}
  />
  <ArtWell
    label={text('Queue_TagPanelDiscLabel')}
    shown={disc}
    chosen={hasDisc}
    finder={text('CoverSearch_HeadingDisc')}
    onTake={(picture) => importQueue.setDisc(rows, picture)}
    onFind={() => (finding = 'disc')}
    onRemove={() => importQueue.setDisc(rows, null)}
  />
</div>

{#if finding}
  <CoverFinder kind={finding} artist={first?.tags.AlbumArtist ?? first?.tags.Artist ?? ''} album={first?.tags.Album ?? ''} onUse={found} onClose={() => (finding = null)} />
{/if}

<style>
  .wells {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
  }
</style>
