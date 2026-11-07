<script lang="ts">
  // A record's own page, in the pane where the collection was: the sleeve with its disc, the keys, the songs, and what
  // is known about it. The room takes the sleeve's colour while it is open. The desktop's reviews are community pages,
  // which the web app does not have.
  import { covers, dossiers, favorites, headClips, player } from '../../app';
  import { durationSeconds } from '../../api/wire';
  import { icons } from '../../design/icons';
  import type { CloudAlbum } from '../../library/albums';
  import { albumFacts, askAbout, type Dossier } from '../../library/dossier';
  import { library, room } from '../../state.svelte';
  import { text } from '../../strings/loc';
  import { menuOn } from '../menu/menu.svelte';
  import AlbumTracks from './AlbumTracks.svelte';
  import { albumMenu, menuAt } from './record-menu.svelte';
  import Stars from './Stars.svelte';

  let { album, onBack }: { album: CloudAlbum; onBack: () => void } = $props();

  let sleeve = $state<string | null>(null);
  let loved = $state(false);
  let known = $state.raw<Dossier | null>(null);

  $effect(() => headClips.warm(album.tracks.map((track) => track.rpmId)));

  $effect(() => {
    room.album = album;
    return () => {
      room.album = null;
    };
  });

  $effect(() => {
    const wanted = album;
    let current = true;
    sleeve = null;
    known = null;
    void covers.url(wanted, 512).then((url) => {
      if (current) sleeve = url;
    });
    const about = wanted.tracks[0] ? askAbout(wanted.tracks[0]) : null;
    if (about)
      dossiers.of(about, wanted.album, wanted.tracks.length).then(
        (answer) => {
          if (current) known = answer;
        },
        () => {},
      );
    return () => {
      current = false;
    };
  });

  $effect(() => {
    void library.marksVersion;
    const wanted = album;
    let current = true;
    void favorites.isAlbumMarked(wanted).then((marked) => {
      if (current) loved = marked;
    });
    return () => {
      current = false;
    };
  });

  const line = $derived.by(() => {
    const first = album.tracks[0];
    const extension = first?.relativePath?.split('.').pop()?.toUpperCase();
    const bits = first?.tags?.bitsPerSample;
    const rate = first?.tags?.sampleRate;
    const depth = bits && rate ? `${bits}/${(rate / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 })}` : '';
    return [album.artist, album.year, extension, depth].filter(Boolean).join('  ·  ');
  });

  const seconds = $derived(album.tracks.reduce((sum, track) => sum + durationSeconds(track), 0));
  const summary = $derived(text(album.tracks.length === 1 ? 'Library_SongsAndTimeOne' : 'Library_SongsAndTime', album.tracks.length, Math.round(seconds / 60)));
  const facts = $derived(albumFacts(known?.album ?? null));

  function shuffle() {
    player.play(album.tracks, 0, { inAlbumOrder: false });
    player.toggleShuffle();
  }
</script>

<div class="sheet" use:menuOn={() => albumMenu(album, 'page')}>
  <button class="back-key" title={text('Album_Back')} aria-label={text('Album_Back')} onclick={onBack}><i class="icon">{icons.backArrow}</i></button>

  <div class="record">
    <div class="stage">
      <span class="disc"></span>
      {#if sleeve}<img src={sleeve} alt="" />{:else}<span class="blank"><i class="icon">{icons.album}</i></span>{/if}
    </div>

    <h2>{album.album}</h2>
    <p class="line">{line}</p>
    <Stars {album} />

    <div class="keys">
      <button class="glass-button primary" title={text('AlbumGrid_PlayAll')} onclick={() => player.play(album.tracks, 0)}><i class="icon">{icons.play}</i>{text('AlbumMenu_Play')}</button>
      <button class="glass-button square" title={text('AlbumGrid_Shuffle')} aria-label={text('AlbumGrid_Shuffle')} onclick={shuffle}><i class="icon">{icons.shuffle}</i></button>
      <button class="glass-button square" class:loved aria-pressed={loved} title={text('AlbumMenu_Favorite')} aria-label={text('AlbumMenu_Favorite')} onclick={() => favorites.markAlbum(album, !loved)}><i class="icon" class:outline={!loved}>{icons.heart}</i></button>
      <button class="glass-button square" title={text('Common_MoreOptions')} aria-label={text('Common_MoreOptions')} onclick={(event) => menuAt(event, albumMenu(album, 'page'))}><i class="icon">{icons.more}</i></button>
    </div>

    <div class="songs">
      <h3>{text('Album_Tracks')}</h3>
      <AlbumTracks {album} columns={1} />
    </div>
  </div>

  <div class="about">
    <div class="facts">
      <p>{summary}</p>
      {#if album.year}<p>{text('Album_Released')} {album.year}</p>{/if}
      {#if facts}<p>{facts}</p>{/if}
    </div>
    {#if known?.albumArticle}
      <section>
        <h3>{text('TrackInfo_AboutAlbum')}</h3>
        <div class="article">
          <strong>{known.albumArticle.title}</strong>
          {#each known.albumArticle.text.split('\n').filter(Boolean) as paragraph}<p>{paragraph}</p>{/each}
        </div>
      </section>
    {/if}
  </div>
</div>

<style>
  .sheet {
    position: relative;
    display: grid;
    grid-template-columns: minmax(0, 380px) minmax(0, 1fr);
    gap: 24px;
    height: 100%;
    box-sizing: border-box;
    padding: 28px 24px 0 28px;
    overflow: hidden;
  }

  .back-key {
    position: absolute;
    z-index: 2;
    top: 22px;
    left: 24px;
  }

  .record {
    display: flex;
    flex-direction: column;
    gap: 6px;
    align-items: center;
    min-height: 0;
    overflow-y: auto;
    scrollbar-width: none;
  }

  .stage {
    position: relative;
    flex: none;
    width: 220px;
    height: 220px;
    margin: 0 44px 12px 0;
  }

  .disc {
    position: absolute;
    top: 6px;
    right: -38px;
    width: 208px;
    height: 208px;
    border-radius: 50%;
    background: repeating-radial-gradient(circle, #0b0b0d 0 2px, #17171b 2px 3px);
    box-shadow: 0 6px 22px rgb(0 0 0 / 0.5);
  }

  img,
  .blank {
    position: relative;
    display: grid;
    place-items: center;
    width: 220px;
    height: 220px;
    object-fit: cover;
    background: rgb(0 0 0 / 0.3);
    box-shadow: 0 6px 22px rgb(0 0 0 / 0.5);
    color: rgb(255 255 255 / 0.3);
    font-size: 40px;
  }

  h2 {
    margin: 0;
    color: #fff;
    font-size: 20px;
    font-weight: 700;
    text-align: center;
  }

  .line {
    margin: 0;
    color: rgb(255 255 255 / 0.72);
    font-size: 12px;
    white-space: pre;
  }

  .keys {
    display: flex;
    flex: none;
    gap: 8px;
    margin: 6px 0 12px;
  }

  .square {
    min-width: 38px;
    padding: 0;
  }

  .keys .icon {
    font-size: 12px;
  }

  .loved {
    color: var(--favorite);
  }

  .songs {
    width: 100%;
  }

  h3 {
    margin: 0 0 8px;
    color: rgb(255 255 255 / 0.67);
    font-size: 12px;
    font-weight: 600;
  }

  .about {
    display: flex;
    flex-direction: column;
    gap: 18px;
    min-height: 0;
    padding-bottom: 18px;
    overflow-y: auto;
  }

  .facts {
    padding: 12px;
    border: 1px solid rgb(255 255 255 / 0.133);
    border-radius: 8px;
    color: rgb(255 255 255 / 0.66);
    font-size: 12px;
    line-height: 1.6;
  }

  .facts p {
    margin: 0;
  }

  .article {
    padding: 12px;
    border-radius: 8px;
    background: rgb(255 255 255 / 0.11);
    color: rgb(255 255 255 / 0.87);
    font-size: 12.5px;
    line-height: 1.5;
  }

  .article strong {
    display: block;
    margin-bottom: 6px;
    font-size: 13px;
  }

  .article p {
    margin: 0 0 8px;
  }
</style>
