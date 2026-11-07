<script lang="ts">
  // One picture of a record: what is shown now, and the ways to change it.
  import type { PickedPicture } from '../../import/cover-search';
  import { text } from '../../strings/loc';

  let { label, shown, chosen, finder, onTake, onFind, onRemove }: {
    label: string;
    shown: string | null;
    chosen: boolean;
    finder: string;
    onTake: (picture: PickedPicture) => void;
    onFind: () => void;
    onRemove: () => void;
  } = $props();

  const MOST_BYTES = 12 * 1024 * 1024;
  const IMAGE = /^image\/(jpeg|png|webp)$/;

  let refusal = $state('');
  let dropping = $state(false);

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
    event.stopPropagation();
    dropping = false;
    void take(event.dataTransfer?.files[0]);
  }
</script>

<div class="cover">
  <span>{label}</span>
  <div
    class="art"
    class:dropping
    role="presentation"
    ondragover={(event) => {
      event.preventDefault();
      event.stopPropagation();
      dropping = true;
    }}
    ondragleave={() => (dropping = false)}
    ondrop={drop}
  >
    {#if shown}<img src={shown} alt="" />{/if}
  </div>
  {#if refusal}<p role="alert">{refusal}</p>{/if}
  <div class="keys">
    <button class="tool" onclick={onFind}>{finder}</button>
    <label class="tool">{text('Profile_ChoosePicture')}<input type="file" accept="image/jpeg,image/png,image/webp" hidden onchange={(event) => take(event.currentTarget.files?.[0])} /></label>
    {#if chosen}<button class="tool" onclick={onRemove}>{text('Profile_RemovePicture')}</button>{/if}
  </div>
</div>

<style>
  .cover {
    display: flex;
    flex: 1 1 160px;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
  }

  span {
    color: var(--text-soft);
    font-size: 11.5px;
  }

  .art {
    width: 120px;
    height: 120px;
    overflow: hidden;
    border-radius: 6px;
    background: rgb(255 255 255 / 0.08);
  }

  .art.dropping {
    outline: 2px dashed rgb(255 255 255 / 0.5);
  }

  img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  p {
    margin: 0;
    color: var(--error);
    font-size: 12px;
  }

  .keys {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
</style>
