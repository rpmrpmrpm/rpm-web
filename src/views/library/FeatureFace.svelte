<script lang="ts" module>
  // One featured card: the act's photograph, the record's cover at the foot, and why it is here.
  import { artistArt, covers } from '../../app';
  import type { CloudAlbum } from '../../library/albums';

  // The pictures each record's card has shown, by album key. The banner draws its cards again on every step,
  // so without this a card that was on screen a moment ago starts blank and fades its photograph in again.
  // A photograph is kept only after it has loaded, so a kept one is drawn at once, without the fade.
  // The loads still run every time, and replace a kept picture when the answer is different.
  const shown = new Map<string, { photo: string | null; sleeve: string | null }>();

  function keep(key: string, pictures: Partial<{ photo: string | null; sleeve: string | null }>) {
    shown.set(key, { photo: null, sleeve: null, ...shown.get(key), ...pictures });
  }

  // The photographs loaded ahead. They are held here so the browser keeps them decoded.
  const warmed = new Map<string, HTMLImageElement>();

  // Loads a card's pictures before it is drawn, so the banner can step to any card with nothing left to load.
  export function warm(album: CloudAlbum) {
    void covers.url(album, 256).then((address) => {
      if (address) keep(album.key, { sleeve: address });
    });
    void artistArt.photo(album.artist).then((address) => {
      if (!address || warmed.get(album.key)?.src === address) return;
      const picture = new Image();
      picture.src = address;
      warmed.set(album.key, picture);
      picture.decode().then(
        () => keep(album.key, { photo: address }),
        () => warmed.delete(album.key),
      );
    });
  }
</script>

<script lang="ts">
  let { album, kicker }: { album: CloudAlbum; kicker: string } = $props();

  let photo = $state<string | null>(null);
  let arrived = $state(false);
  let sleeve = $state<string | null>(null);

  $effect(() => {
    const wanted = album;
    const known = shown.get(wanted.key);
    const knownPhoto = known?.photo ?? null;
    const knownSleeve = known?.sleeve ?? null;
    let current = true;
    photo = knownPhoto;
    arrived = knownPhoto !== null;
    sleeve = knownSleeve;
    void artistArt.photo(wanted.artist).then((address) => {
      if (!current || address === knownPhoto) return;
      arrived = false;
      photo = address;
    });
    void covers.url(wanted, 256).then((address) => {
      if (!current) return;
      keep(wanted.key, { sleeve: address });
      if (address !== knownSleeve) sleeve = address;
    });
    return () => {
      current = false;
    };
  });
</script>

<div class="face">
  {#if sleeve}<img class="photo soft" src={sleeve} alt="" />{/if}
  {#if photo}<img
      class="photo"
      class:arrived
      src={photo}
      alt=""
      onload={() => {
        arrived = true;
        keep(album.key, { photo });
      }}
    />{/if}
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

  /* The whole card, pinned right: the subject is framed against the edge that stays still. It fades in, because it
     arrives after the card has been drawn on the sleeve's blur. */
  .photo {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    object-position: right center;
    opacity: 0;
    transition: opacity 300ms ease;
  }

  .photo.arrived {
    opacity: 1;
  }

  .photo.soft {
    opacity: 0.7;
    filter: blur(30px) saturate(1.3);
    transform: scale(1.15);
  }

  /* One flat veil, so the picture is one exposure from end to end with nothing down its left, and a scrim from the
     foot for the words. */
  .scrim {
    position: absolute;
    inset: 0;
    background:
      linear-gradient(transparent 38%, rgb(0 0 0 / 0.122) 65.9%, rgb(0 0 0 / 0.302) 84.5%, rgb(0 0 0 / 0.651)),
      linear-gradient(rgb(0 0 0 / 0.2), rgb(0 0 0 / 0.2));
  }

  .foot {
    position: absolute;
    right: 22px;
    bottom: 18px;
    left: 22px;
    display: flex;
    gap: 20px;
    align-items: center;
  }

  .sleeve {
    flex: none;
    width: 124px;
    height: 124px;
    border-radius: 8px;
    object-fit: cover;
    box-shadow: 0 0 0 1px rgb(255 255 255 / 0.24);
  }

  .blank {
    background: rgb(0 0 0 / 0.3);
  }

  .words {
    display: flex;
    flex-direction: column;
    gap: 6px;
    justify-content: flex-end;
    min-width: 0;
    margin-right: 96px;
    text-shadow: 0 1px 5px rgb(0 0 0 / 0.7);
  }

  .kicker {
    overflow: hidden;
    color: rgb(255 255 255 / 0.66);
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.11em;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  strong {
    display: -webkit-box;
    overflow: hidden;
    color: #fff;
    font-size: 24px;
    font-weight: 700;
    line-height: 29px;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
  }

  @media (max-width: 699px) {
    .words {
      margin-right: 0;
    }
  }

  .act {
    overflow: hidden;
    color: rgb(255 255 255 / 0.8);
    font-size: 13.5px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
