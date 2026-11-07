<script lang="ts">
  // One featured card: the act's photograph, the record's cover at the foot, and why it is here.
  import { artistArt, covers } from '../../app';
  import type { CloudAlbum } from '../../library/albums';

  let { album, kicker }: { album: CloudAlbum; kicker: string } = $props();

  let photo = $state<string | null>(null);
  let sleeve = $state<string | null>(null);

  $effect(() => {
    const wanted = album;
    let current = true;
    photo = null;
    sleeve = null;
    void artistArt.photo(wanted.artist).then((address) => {
      if (current) photo = address;
    });
    void covers.url(wanted, 256).then((address) => {
      if (current) sleeve = address;
    });
    return () => {
      current = false;
    };
  });
</script>

<div class="face">
  {#if photo}<img class="photo" src={photo} alt="" />{:else if sleeve}<img class="photo soft" src={sleeve} alt="" />{/if}
  <div class="scrim"></div>
  <div class="foot">
    {#if sleeve}<img class="sleeve" src={sleeve} alt="" />{:else}<div class="sleeve blank"></div>{/if}
    <div class="words">
      <span class="kicker">{kicker}</span>
      <strong>{album.album}</strong>
      <span class="act">{album.artist}</span>
    </div>
  </div>
</div>

<style>
  .face {
    position: relative;
    width: 100%;
    height: 100%;
    overflow: hidden;
    border-radius: inherit;
    background: #191b20;
  }

  .photo {
    position: absolute;
    top: 0;
    right: 0;
    width: 78%;
    height: 100%;
    object-fit: cover;
  }

  .photo.soft {
    width: 100%;
    opacity: 0.7;
    filter: blur(30px) saturate(1.3);
    transform: scale(1.15);
  }

  .scrim {
    position: absolute;
    inset: 0;
    background: linear-gradient(90deg, #191b20 22%, rgb(25 27 32 / 0.6) 48%, rgb(25 27 32 / 0.2) 78%), linear-gradient(transparent 45%, rgb(0 0 0 / 0.55));
  }

  .foot {
    position: absolute;
    right: 22px;
    bottom: 22px;
    left: 22px;
    display: flex;
    gap: 16px;
    align-items: flex-end;
  }

  .sleeve {
    flex: none;
    width: 124px;
    height: 124px;
    border-radius: 6px;
    object-fit: cover;
    box-shadow: 0 0 0 1px rgb(255 255 255 / 0.18);
  }

  .blank {
    background: rgb(255 255 255 / 0.08);
  }

  .words {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
    text-shadow: 0 1px 6px rgb(0 0 0 / 0.7);
  }

  .kicker {
    color: rgb(255 255 255 / 0.8);
    font-size: 13.5px;
    letter-spacing: 0.08em;
  }

  strong {
    overflow: hidden;
    color: #fff;
    font-size: 26px;
    font-weight: 700;
    line-height: 1.15;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .act {
    overflow: hidden;
    color: rgb(255 255 255 / 0.85);
    font-size: 15px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
