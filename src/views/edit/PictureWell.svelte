<script lang="ts">
  // One of a record's pictures in an edit window (the desktop's PictureWell): the square, what it is, then
  // Change, Find art and Remove under it. The disc label is drawn round, as the record shows it.
  import type { Snippet } from 'svelte';

  import { icons } from '../../design/icons';
  import { text } from '../../strings/loc';

  let {
    heading,
    shown,
    bytes = 0,
    disc = false,
    edge = 220,
    disabled = false,
    onTake,
    onFind,
    onRemove,
    tick,
  }: {
    heading: string;
    // A blob address for what is shown now, or null for an empty well.
    shown: string | null;
    bytes?: number;
    disc?: boolean;
    edge?: number;
    disabled?: boolean;
    onTake: (picture: { bytes: Uint8Array; mime: string }) => void;
    onFind: () => void;
    onRemove: () => void;
    tick?: Snippet;
  } = $props();

  const MOST_BYTES = 12 * 1024 * 1024;
  const IMAGE = /^image\/(jpeg|png|webp)$/;

  let size = $state<{ width: number; height: number } | null>(null);
  let refusal = $state('');
  let dropping = $state(false);

  const info = $derived(shown && size ? `${size.width}×${size.height} · ${text('Unit_KB', Math.max(1, Math.round(bytes / 1024)))}` : shown ? '' : text('Details_NoArt'));

  async function take(file: File | undefined) {
    refusal = '';
    if (!file) return;
    if (!IMAGE.test(file.type) || file.size > MOST_BYTES) {
      refusal = text('Profile_PictureFailed');
      return;
    }
    onTake({ bytes: new Uint8Array(await file.arrayBuffer()), mime: file.type });
  }

  function drop(event: DragEvent) {
    event.preventDefault();
    dropping = false;
    if (!disabled) void take(event.dataTransfer?.files[0]);
  }
</script>

<div class="picture" style:--edge="{edge}px">
  <div class="head">
    {@render tick?.()}
    <h3>{text(heading)}</h3>
  </div>
  <div
    class="well"
    class:disc
    class:dropping
    role="presentation"
    ondragover={(event) => {
      event.preventDefault();
      dropping = !disabled;
    }}
    ondragleave={() => (dropping = false)}
    ondrop={drop}
  >
    {#if shown}
      <img
        src={shown}
        alt=""
        onload={(event) => {
          const image = event.currentTarget as HTMLImageElement;
          size = { width: image.naturalWidth, height: image.naturalHeight };
        }}
      />
      {#if disc}<span class="hub"></span>{/if}
    {:else}
      <i class="icon empty">{icons.album}</i>
    {/if}
  </div>
  <p class="info">{info}</p>
  {#if refusal}<p class="refusal" role="alert">{refusal}</p>{/if}
  <div class="keys">
    <label class="glass-button dense" class:off={disabled}>
      <i class="icon">{icons.image}</i>{text('Details_ChangeArt')}
      <input type="file" accept="image/jpeg,image/png,image/webp" hidden {disabled} onchange={(event) => take(event.currentTarget.files?.[0])} />
    </label>
    <button class="glass-button dense" type="button" {disabled} onclick={onFind}><i class="icon">{icons.search}</i>{text('Details_FindArt')}</button>
    <button class="glass-button dense square" type="button" disabled={disabled || !shown} title={text('Details_RemoveArt')} aria-label={text('Details_RemoveArt')} onclick={onRemove}>
      <i class="icon">{icons.trash}</i>
    </button>
  </div>
</div>

<style>
  .picture {
    display: grid;
    gap: 6px;
    width: var(--edge);
    align-content: start;
  }

  .head {
    display: flex;
    gap: 8px;
    align-items: center;
    padding-bottom: 3px;
    border-bottom: 1px solid rgb(255 255 255 / 0.122);
    margin-bottom: 2px;
  }

  h3 {
    margin: 0;
    color: rgb(255 255 255 / 0.45);
    font-size: 10.5px;
    font-weight: 600;
    letter-spacing: 0.08em;
  }

  .well {
    position: relative;
    display: grid;
    place-items: center;
    width: var(--edge);
    height: var(--edge);
    overflow: hidden;
    border: 1px solid rgb(255 255 255 / 0.12);
    border-radius: 8px;
    background: rgb(0 0 0 / 0.35);
  }

  .well.disc {
    border-radius: 50%;
  }

  .well.dropping {
    outline: 2px dashed rgb(255 255 255 / 0.5);
  }

  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .hub {
    position: absolute;
    width: 22%;
    height: 22%;
    border: 3px solid rgb(255 255 255 / 0.5);
    border-radius: 50%;
    background: rgb(20 22 28);
  }

  .empty {
    color: rgb(255 255 255 / 0.3);
    font-size: calc(var(--edge) * 0.24);
  }

  .info {
    margin: 0;
    overflow: hidden;
    color: rgb(255 255 255 / 0.65);
    font-size: 11px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .refusal {
    margin: 0;
    color: var(--error);
    font-size: 11.5px;
  }

  .keys {
    display: flex;
    gap: 6px;
  }

  .dense {
    display: inline-flex;
    flex: 1;
    gap: 6px;
    align-items: center;
    justify-content: center;
    min-width: 0;
    height: 24px;
    padding: 0 8px;
    font-size: 11.5px;
    font-weight: 400;
    white-space: nowrap;
    cursor: pointer;
  }

  .dense .icon {
    font-size: 11px;
  }

  .dense.square {
    flex: none;
    width: 30px;
    padding: 0;
  }

  .dense.off {
    opacity: 0.45;
    pointer-events: none;
  }
</style>
