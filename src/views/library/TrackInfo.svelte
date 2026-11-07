<script lang="ts">
  // Track info: the band's photograph, the song and its sleeve, the words, and what is known about the act and
  // the record. Each thing paints as it lands. What is not known gets no line, and an answer nobody gave is not
  // shown as nothing to say.
  import { artistArt, covers, dossiers } from '../../app';
  import { icons } from '../../design/icons';
  import { askAbout, type Dossier } from '../../library/dossier';
  import { library, now } from '../../state.svelte';
  import { text } from '../../strings/loc';
  import { asked } from './record-menu.svelte';
  import Heart from './Heart.svelte';
  import LyricWell from './LyricWell.svelte';
  import AboutCards from './AboutCards.svelte';

  let { compact = false }: { compact?: boolean } = $props();

  // The sleeve hangs from a line below the foot of the photograph, and grows up over the picture.
  const SLEEVE = 128;
  const SLEEVE_DROP = 46;

  // What scrolls under the heading goes out of sight rather than running through it.
  const FADE_DEPTH = 100;

  const track = $derived(now.track);
  const album = $derived(track ? library.albums.find((held) => held.tracks.some((row) => row.rpmId === track.rpmId)) : undefined);
  const about = $derived(track ? askAbout(track) : null);
  const tracks = $derived(album?.tracks.length ?? track?.tags?.trackCount ?? 0);

  let sleeve = $state<string | null>(null);
  let photo = $state<string | null>(null);
  let dossier = $state.raw<Dossier | null>(null);
  let scrolled = $state(0);

  $effect(() => {
    const wanted = album;
    let current = true;
    sleeve = null;
    if (wanted) {
      void covers.url(wanted, 512).then((url) => {
        if (current) sleeve = url;
      });
    }
    return () => {
      current = false;
    };
  });

  // The same artist keeps the photograph and the card, which is most changes of track.
  $effect(() => {
    const name = about;
    let current = true;
    photo = null;
    if (name) {
      void artistArt.photo(name).then((url) => {
        if (current) photo = url;
      });
    }
    return () => {
      current = false;
    };
  });

  $effect(() => {
    const name = about;
    const record = track?.album ?? null;
    const count = tracks;
    let current = true;
    dossier = null;
    if (name) {
      dossiers.of(name, record, count).then(
        (found) => {
          if (current) dossier = found;
        },
        () => {},
      );
    }
    return () => {
      current = false;
    };
  });

</script>

<div class="sheet" class:compact>
  {#if photo}
    <img class="wash" src={photo} alt="" />
  {/if}
  <h2 class="heading">{text('TrackInfo_PaneTitle')}</h2>

  {#if track}
    <div class="scroll" style:--fade="{Math.min(scrolled, FADE_DEPTH)}px" onscroll={(event) => (scrolled = event.currentTarget.scrollTop)}>
      <div class="hero" class:withPhoto={photo}>
        {#if photo}
          <div class="photo">
            <img src={photo} alt="" />
          </div>
        {/if}
        <div class="foot" style:margin-top={photo ? `${SLEEVE_DROP - SLEEVE}px` : undefined}>
          <div class="title" style:margin-top={photo ? `${SLEEVE - SLEEVE_DROP + 12}px` : undefined}>
            <h3>{track.title}</h3>
            <p>{track.artist}</p>
          </div>
          <div class="art">
            <div class="sleeve">
              {#if sleeve}<img src={sleeve} alt="" />{:else}<i class="icon">{icons.album}</i>{/if}
            </div>
            <div class="keys">
              <span class="glass-button primary heart"><Heart {track} /></span>
              {#if album}
                <button class="glass-button primary open" title={text('AlbumMenu_AlbumPage')} onclick={() => (asked.opening = album ?? null)}>
                  <i class="icon">{icons.album}</i>{text('TrackInfo_OpenAlbum')}<i class="icon small">{icons.forward}</i>
                </button>
              {/if}
            </div>
          </div>
        </div>
      </div>

      <LyricWell {track} />

      <div class="about">
        <AboutCards {dossier} artistName={about} albumName={track.album} />
      </div>

      {#if track.tags?.composer}
        <section>
          <h3>{text('TrackInfo_GroupCredits')}</h3>
          <dl><dt>{text('Details_Composers')}</dt><dd>{track.tags.composer}</dd></dl>
        </section>
      {/if}
    </div>
  {:else}
    <div class="empty">
      <i class="icon">{icons.info}</i>
      <p>{text('NowPlaying_Empty')}</p>
    </div>
  {/if}
</div>


<style>
  .sheet {
    position: relative;
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    overflow: hidden;
  }

  /* The pane takes its colour from the photograph behind everything else. */
  .wash {
    position: absolute;
    inset: -20%;
    width: 140%;
    height: 140%;
    object-fit: cover;
    opacity: 0.32;
    filter: blur(50px) saturate(1.2);
    pointer-events: none;
  }

  .heading {
    position: absolute;
    top: 12px;
    left: 16px;
    z-index: 2;
    padding-top: 0;
    pointer-events: none;
  }

  .scroll {
    position: relative;
    display: flex;
    flex-direction: column;
    flex: 1;
    gap: 18px;
    min-height: 0;
    padding-bottom: 24px;
    overflow-y: auto;
    scrollbar-width: none;
    mask-image: linear-gradient(to bottom, transparent calc(var(--fade) * 0.45), #000 var(--fade));
  }

  .scroll::-webkit-scrollbar {
    display: none;
  }

  .hero:not(.withPhoto) {
    padding-top: 64px;
  }

  /* A 4 by 3 box, a crown under the heading, and a foot that dissolves into the pane by the line that names
     the record. */
  .photo {
    position: relative;
    aspect-ratio: 4 / 3;
    overflow: hidden;
    mask-image: linear-gradient(to bottom, #000 calc(100% - 172px), transparent);
  }

  .photo img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
    object-position: left top;
  }

  .photo::before {
    position: absolute;
    top: 0;
    right: 0;
    left: 0;
    height: 96px;
    background: linear-gradient(rgb(0 0 0 / 0.5), rgb(0 0 0 / 0.36) 35%, rgb(0 0 0 / 0.18) 72%, transparent);
    content: '';
  }

  .foot {
    position: relative;
    display: flex;
    gap: 12px;
    align-items: flex-start;
    justify-content: space-between;
    margin-inline: 16px;
  }

  .title {
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
  }

  .title h3 {
    margin: 0;
    color: #fff;
    font-size: 18px;
    font-weight: 700;
    overflow-wrap: anywhere;
  }

  .title p {
    margin: 0;
    color: rgb(255 255 255 / 0.67);
    font-size: 12px;
  }

  .art {
    display: flex;
    flex: none;
    flex-direction: column;
    gap: 8px;
    width: 128px;
    margin-right: 14px;
  }

  .sleeve {
    display: grid;
    place-items: center;
    width: 128px;
    height: 128px;
    overflow: hidden;
    border-radius: 12px;
    background: rgb(0 0 0 / 0.2);
    color: rgb(255 255 255 / 0.25);
    font-size: 36px;
  }

  .sleeve img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .keys {
    display: grid;
    grid-template-columns: 32px minmax(0, 1fr);
    gap: 5px;
  }

  .keys .glass-button {
    gap: 5px;
    justify-content: center;
    min-width: 0;
    padding: 0;
    font-size: 12px;
  }

  .keys .heart {
    display: inline-flex;
    align-items: center;
  }

  .small {
    font-size: 9px;
    opacity: 0.7;
  }

  section,
  .about {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin: 0 16px;
  }

  .about {
    gap: 18px;
  }

  section > h3 {
    margin: 0;
    color: rgb(255 255 255 / 0.67);
    font-size: 12px;
    font-weight: 600;
  }

  dl {
    display: grid;
    grid-template-columns: 104px minmax(0, 1fr);
    gap: 6px 10px;
    margin: 0;
  }

  dt {
    color: rgb(255 255 255 / 0.53);
    font-size: 11px;
  }

  dd {
    margin: 0;
    color: rgb(255 255 255 / 0.87);
    font-size: 12px;
  }

  .empty {
    position: relative;
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 14px;
    align-items: center;
    justify-content: center;
    padding: 24px;
  }

  .empty .icon {
    color: rgb(255 255 255 / 0.2);
    font-size: 40px;
  }

  .empty p {
    max-width: 240px;
    margin: 0;
    color: rgb(255 255 255 / 0.47);
    font-size: 13px;
    text-align: center;
  }
</style>
