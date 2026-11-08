<script lang="ts">
  // A record on a phone: a page of its own over the wall, with what is known about it under the songs, as on
  // the record's page on a computer.
  import { covers, dossiers } from '../../app';
  import { icons } from '../../design/icons';
  import type { CloudAlbum } from '../../library/albums';
  import { askAbout, type Dossier } from '../../library/dossier';
  import { text } from '../../strings/loc';
  import AboutCards from './AboutCards.svelte';
  import RecordSpinner from './RecordSpinner.svelte';
  import AlbumDetail from './AlbumDetail.svelte';

  let { album, onClose }: { album: CloudAlbum; onClose: () => void } = $props();

  let sleeve = $state<string | null>(null);
  let known = $state.raw<Dossier | null>(null);
  // A record turns where the cards will stand while the papers are asked for.
  let asking = $state(false);

  $effect(() => {
    const wanted = album;
    let current = true;
    void covers.url(wanted, 1024).then((url) => {
      if (current) sleeve = url;
    });
    known = null;
    const about = wanted.tracks[0] ? askAbout(wanted.tracks[0]) : null;
    asking = !!about;
    if (about)
      dossiers.of(about, wanted.album, wanted.tracks.length).then(
        (answer) => {
          if (!current) return;
          known = answer;
          asking = false;
        },
        () => {
          if (current) asking = false;
        },
      );
    return () => {
      current = false;
    };
  });
</script>

<section class="page">
  <button class="key" title={text('Common_Cancel')} onclick={onClose}><i class="icon">{icons.back}</i></button>
  {#if sleeve}<img src={sleeve} alt="" />{/if}
  <AlbumDetail {album} columns={1} rating />
  <div class="about">
    {#if asking}<div class="asking"><RecordSpinner size={52} /></div>{:else}<AboutCards dossier={known} artistName={album.artist} albumName={album.album} albumFirst />{/if}
  </div>
</section>

<style>
  .asking {
    display: grid;
    place-items: center;
    padding: 18px 0;
  }

  .page {
    position: fixed;
    inset: 0 0 calc(56px + env(safe-area-inset-bottom));
    z-index: 3;
    padding: max(8px, env(safe-area-inset-top)) 16px 90px;
    overflow-y: auto;
    background: #080a10;
  }

  .about {
    display: flex;
    flex-direction: column;
    gap: 18px;
    margin-top: 24px;
  }

  img {
    display: block;
    width: 100%;
    max-width: 420px;
    margin: 4px auto 16px;
    border-radius: 10px;
  }
</style>
