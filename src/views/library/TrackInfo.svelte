<script lang="ts">
  // Track info: the band's photograph, the song and its sleeve, the words, and what is known about the act and
  // the record. Each thing paints as it lands. What is not known gets no line, and an answer nobody gave is not
  // shown as nothing to say.
  import { artistArt, covers, dossiers, encyclopediaCards, remoteTags } from '../../app';
  import { icons } from '../../design/icons';
  import type { ConductorCard, LabelCard } from '../../library/cards';
  import { albumParts, creditsOf, partOf, sidecarText } from '../../library/credits';
  import { askAbout, type Dossier } from '../../library/dossier';
  import type { TagSet } from '../../library/tag-fields';
  import { library, now } from '../../state.svelte';
  import { text } from '../../strings/loc';
  import { asked } from './record-menu.svelte';
  import Heart from './Heart.svelte';
  import LyricWell from './LyricWell.svelte';
  import AboutCards from './AboutCards.svelte';
  import RecordSpinner from './RecordSpinner.svelte';

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
  // undefined while the question is out, null when it failed or there is nobody to ask about.
  let dossier = $state.raw<Dossier | null | undefined>(null);
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
  // Whether the pictures are still being fetched: a record turns in the pane's top corner while they are.
  let picturesAsked = $state(false);

  $effect(() => {
    const name = about;
    let current = true;
    photo = null;
    picturesAsked = !!name;
    if (name) {
      void artistArt.photo(name).then(
        (url) => {
          if (!current) return;
          photo = url;
          picturesAsked = false;
        },
        () => {
          if (current) picturesAsked = false;
        },
      );
    }
    return () => {
      current = false;
    };
  });

  // The papers: the act and the record. They are asked again only when the act or the record changes, not on
  // every track of a record. The conductor and the label of the record go with them (below).
  $effect(() => {
    const name = about;
    const record = track?.album ?? null;
    const count = tracks;
    let current = true;
    dossier = name ? undefined : null;
    conductor = null;
    label = null;
    picked = null;
    if (name) {
      dossiers.of(name, record, count).then(
        (found) => {
          if (current) dossier = found;
        },
        () => {
          if (current) dossier = null;
        },
      );
    }
    return () => {
      current = false;
    };
  });

  // The track's own tags, from its sidecar: the credits, and the conductor and the label they name. Kept with the
  // track they belong to, so a line from the last track is never shown under this one.
  let credited = $state.raw<{ rpmId: string; sidecar: TagSet | null } | null>(null);
  let conductor = $state.raw<ConductorCard | null>(null);
  let label = $state.raw<LabelCard | null>(null);
  let cardsAsked = $state(false);

  $effect(() => {
    const playing = track;
    let current = true;
    if (!playing) return;
    cardsAsked = true;
    void remoteTags
      .of(playing.rpmId)
      .catch(() => null)
      .then(async (sidecar) => {
        if (!current) return;
        credited = { rpmId: playing.rpmId, sidecar };
        const credit = sidecarText(sidecar, 'Conductor');
        const tag = sidecarText(sidecar, 'Publisher');
        // A card that cannot be found or fetched is no card: the papers go up without it.
        const [who, house] = await Promise.all([
          credit ? encyclopediaCards.conductor(credit).catch(() => null) : null,
          tag ? encyclopediaCards.label(tag).catch(() => null) : null,
        ]);
        if (!current) return;
        conductor = who;
        label = house;
        cardsAsked = false;
      });
    return () => {
      current = false;
    };
  });

  const credits = $derived(track ? creditsOf(track, credited?.rpmId === track.rpmId ? credited.sidecar : null) : []);

  // A record that is several works under one title has a page for each. The whole title comes first where it has
  // an article of its own. The page that opens is the work the playing track belongs to, or the first.
  const parts = $derived(albumParts(track?.album));
  const pages = $derived.by(() => {
    if (!parts.length) return [];
    const whole = dossier?.albumArticle ? [{ title: track?.album ?? '', whole: true }] : [];
    return [...whole, ...parts.map((title) => ({ title, whole: false }))];
  });
  let picked = $state<number | null>(null);
  const pageAt = $derived(pages.length ? Math.min(picked ?? partOf(parts, track?.tags?.work) + (pages[0]?.whole && track?.tags?.work ? 1 : 0), pages.length - 1) : 0);
  const page = $derived(pages[pageAt] ?? null);

  // The papers of the part on its page, asked when the page is shown.
  let partPapers = $state.raw<{ title: string; dossier: Dossier | null } | null>(null);
  $effect(() => {
    const name = about;
    const part = page && !page.whole ? page.title : null;
    let current = true;
    if (!name || !part) return;
    dossiers.of(name, part, 0).then(
      (found) => {
        if (current) partPapers = { title: part, dossier: found };
      },
      () => {
        if (current) partPapers = { title: part, dossier: null };
      },
    );
    return () => {
      current = false;
    };
  });

  // What the cards show: the act from the record's papers, and the record from the page's.
  const shownDossier = $derived.by((): Dossier | null => {
    if (!dossier || !page || page.whole) return dossier ?? null;
    const own = partPapers?.title === page.title ? partPapers.dossier : null;
    return { ...dossier, album: own?.album ?? null, albumArticle: own?.albumArticle ?? null };
  });
  const albumPages = $derived(page ? { count: pages.length, at: pageAt, title: page.title, pick: (at: number) => (picked = at) } : null);

  // The papers, the two cards and the credits go up together, as the desktop's text region does. While they are
  // on their way the region is empty, with one record turning: in the top corner while the pictures are still
  // coming, and in the middle of the region after that. Never two.
  const waiting = $derived(dossier === undefined || cardsAsked);
</script>

<div class="sheet" class:compact>
  {#if photo}
    <img class="wash" src={photo} alt="" />
  {/if}
  <h2 class="heading">{text('TrackInfo_PaneTitle')}</h2>
  {#if track && picturesAsked}<div class="picture-busy"><RecordSpinner size={34} /></div>{/if}

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
        {#if waiting}
          <div class="waiting">{#if !picturesAsked}<RecordSpinner size={52} />{/if}</div>
        {:else}
          <AboutCards dossier={shownDossier} artistName={about} albumName={track.album} {conductor} {label} {albumPages} />
        {/if}
      </div>

      {#if credits.length && !waiting}
        <section>
          <h3>{text('TrackInfo_GroupCredits')}</h3>
          <dl>
            {#each credits as credit (credit.label)}<dt>{text(credit.label)}</dt><dd>{credit.value}</dd>{/each}
          </dl>
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

  .picture-busy {
    position: absolute;
    z-index: 2;
    top: 13px;
    right: 16px;
    pointer-events: none;
  }

  /* Where the papers will stand, while they are on their way. */
  .waiting {
    display: grid;
    place-items: center;
    min-height: 120px;
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
