<script lang="ts">
  // What is known about a record and the act that made it: the cards Track info and a record's page show, as
  // the desktop shows them. Each card stands only where there is something to put on it.
  import { activeOf, capitalised, lifeOf, siteName as cardSite, type CardLink, type ConductorCard, type LabelCard } from '../../library/cards';
  import { elsewhere, albumFacts, artistFacts, hasMore, lead, type Dossier } from '../../library/dossier';
  import { icons } from '../../design/icons';
  import type { Article } from '../../library/articles';
  import { text } from '../../strings/loc';
  import MemberFace from './MemberFace.svelte';

  let {
    dossier,
    artistName,
    albumName,
    albumFirst = false,
    conductor = null,
    label = null,
    albumPages = null,
  }: {
    dossier: Dossier | null;
    // What to call the act and the record where the catalogues have no name for them.
    artistName: string | null;
    albumName: string | null;
    // A record's page leads with the record, Track info with the act.
    albumFirst?: boolean;
    // The conductor a classical record credits and the label it names, under the album's card. Track info only.
    conductor?: ConductorCard | null;
    label?: LabelCard | null;
    // A record that is several works under one title has a page for each, with dots under the card. title is the
    // part the card is on, which it names while the part's papers are on their way.
    albumPages?: { count: number; at: number; title: string; pick: (at: number) => void } | null;
  } = $props();

  let artistOpen = $state(false);
  let albumOpen = $state(false);
  let conductorOpen = $state(false);
  let labelOpen = $state(false);

  $effect(() => {
    void dossier;
    artistOpen = false;
    albumOpen = false;
  });

  $effect(() => {
    void conductor;
    conductorOpen = false;
  });

  $effect(() => {
    void label;
    labelOpen = false;
  });

  const life = $derived(conductor ? lifeOf(conductor) : null);
  const active = $derived(label ? activeOf(label) : null);
  const linkName = (link: CardLink) => cardSite(link) ?? text('TrackInfo_OfficialSite');

  const artist = $derived(dossier?.artist ?? null);
  const record = $derived(dossier?.album ?? null);
  const links = $derived(dossier ? elsewhere(dossier) : []);
  const lineup = $derived(artist?.kind?.toLowerCase() === 'group' ? (artist.members ?? []) : []);
  const artistLine = $derived(artistFacts(artist));
  const albumLine = $derived(albumFacts(record));
  const tags = $derived(record?.genres ?? []);
  const artistCard = $derived(!!(artistLine || dossier?.artistArticle));
  const albumCard = $derived(!!(albumLine || tags.length || dossier?.albumArticle || albumPages));

  const shown = (article: Article, open: boolean) => (open ? article.text : lead(article));
  const siteName = (site: string) => (site === 'official' ? text('TrackInfo_OfficialSite') : { discogs: 'Discogs', bandcamp: 'Bandcamp', facebook: 'Facebook', x: 'X', instagram: 'Instagram' }[site]);
</script>

{#snippet articleOf(article: Article, open: boolean, toggle: () => void)}
  <p class="prose">{shown(article, open)}</p>
  <div class="links">
    {#if hasMore(article)}
      <button class="link" onclick={toggle}>{text(open ? 'TrackInfo_ShowLess' : 'TrackInfo_ShowMore')}</button>
    {/if}
    <a class="link" href={article.url} target="_blank" rel="noopener">{text('TrackInfo_ReadOnWikipedia')}</a>
  </div>
  <a class="licence" href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noopener" title={text('Wikipedia_LicenceTip')}>{text('Wikipedia_Licence')}</a>
{/snippet}

{#snippet artistCards()}
  {#if artistCard}
    <section>
      <h3>{text('TrackInfo_AboutArtist')}</h3>
      <div class="card">
        <strong>{artist?.name ?? dossier?.artistArticle?.title ?? artistName}</strong>
        {#if artistLine}<small>{artistLine}</small>{/if}
        {#if dossier?.artistArticle}{@render articleOf(dossier.artistArticle, artistOpen, () => (artistOpen = !artistOpen))}{/if}
      </div>
    </section>
  {/if}

  {#if lineup.length}
    <section>
      <h3>{text('TrackInfo_Members')}</h3>
      <div class="card members">
        {#each lineup as member (member.name)}<MemberFace {member} />{/each}
      </div>
    </section>
  {/if}
{/snippet}

{#snippet cardLinks(links: CardLink[])}
  {#if links.length}
    <div class="card-links">
      {#each links as link (link.url)}<a class="link" href={link.url} target="_blank" rel="noopener" title={link.url}>{linkName(link)}</a>{/each}
    </div>
  {/if}
{/snippet}

{#snippet albumCards()}
  {#if albumCard}
    <section>
      <h3>{text('TrackInfo_AboutAlbum')}</h3>
      <div class="card">
        <strong>{record?.title ?? dossier?.albumArticle?.title ?? albumPages?.title ?? albumName}</strong>
        {#if albumLine}<small>{albumLine}</small>{/if}
        {#if tags.length}
          <div class="chips">{#each tags as tag}<span>{tag}</span>{/each}</div>
        {/if}
        {#if dossier?.albumArticle}{@render articleOf(dossier.albumArticle, albumOpen, () => (albumOpen = !albumOpen))}{/if}
        {#if albumPages && albumPages.count > 1}
          <div class="dots">
            {#each { length: albumPages.count } as _, index (index)}
              <button class:on={index === albumPages.at} aria-label={String(index + 1)} aria-current={index === albumPages.at} onclick={() => albumPages.pick(index)}></button>
            {/each}
          </div>
        {/if}
      </div>
    </section>
  {/if}

  {#if conductor}
    <section>
      <h3>{text('TrackInfo_AboutConductor')}</h3>
      <div class="card">
        <div class="flow">
          <div class="photo">
            {#if conductor.photoUrl}<img src={conductor.photoUrl} alt="" />{:else}<i class="icon">{icons.artist}</i>{/if}
          </div>
          <strong>{conductor.name}</strong>
          {#if conductor.roles.length}<small class="quiet">{capitalised(conductor.roles)}</small>{/if}
          {#if life}<small>{'text' in life ? life.text : text(life.key, ...life.values)}</small>{/if}
          {#if conductor.article}<p class="prose">{shown(conductor.article, conductorOpen)}</p>{/if}
        </div>
        {#if conductor.article}
          <div class="links">
            {#if hasMore(conductor.article)}
              <button class="link" onclick={() => (conductorOpen = !conductorOpen)}>{text(conductorOpen ? 'TrackInfo_ShowLess' : 'TrackInfo_ShowMore')}</button>
            {/if}
            <a class="link" href={conductor.article.url} target="_blank" rel="noopener">{text('TrackInfo_ReadOnWikipedia')}</a>
          </div>
        {/if}
        {@render cardLinks(conductor.links)}
        {#if conductor.article}
          <a class="licence" href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noopener" title={text('Wikipedia_LicenceTip')}>{text('Wikipedia_Licence')}</a>
        {/if}
      </div>
    </section>
  {/if}

  {#if label}
    <section>
      <h3>{text('TrackInfo_AboutLabel')}</h3>
      <div class="card">
        <div class="flow">
          {#if label.logoUrl}<img class="logo" src={label.logoUrl} alt="" />{/if}
          <strong>{label.name}</strong>
          {#if active}<small>{text(active.key, ...active.values)}</small>{/if}
          {#if label.genres.length}<small class="quiet">{capitalised(label.genres)}</small>{/if}
          {#if label.article}<p class="prose">{shown(label.article, labelOpen)}</p>{/if}
        </div>
        {#if label.article}
          <div class="links">
            {#if hasMore(label.article)}
              <button class="link" onclick={() => (labelOpen = !labelOpen)}>{text(labelOpen ? 'TrackInfo_ShowLess' : 'TrackInfo_ShowMore')}</button>
            {/if}
            <a class="link" href={label.article.url} target="_blank" rel="noopener">{text('TrackInfo_ReadOnWikipedia')}</a>
          </div>
        {/if}
        {@render cardLinks(label.links)}
        {#if label.article}
          <a class="licence" href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noopener" title={text('Wikipedia_LicenceTip')}>{text('Wikipedia_Licence')}</a>
        {/if}
      </div>
    </section>
  {/if}
{/snippet}

{#if albumFirst}
  {@render albumCards()}
  {@render artistCards()}
{:else}
  {@render artistCards()}
  {@render albumCards()}
{/if}

{#if links.length}
  <section>
    <h3>{text('TrackInfo_Elsewhere')}</h3>
    <div class="elsewhere">
      {#each links as link (link.site)}
        <a href={link.url} target="_blank" rel="noopener" title={link.url}><b>{siteName(link.site)}</b><span>{link.url}</span></a>
      {/each}
    </div>
  </section>
{/if}

<style>
  section {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  section > h3 {
    margin: 0;
    color: rgb(255 255 255 / 0.67);
    font-size: 12px;
    font-weight: 600;
  }

  .card {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 14px;
    border-radius: 8px;
    background: rgb(255 255 255 / 0.094);
  }

  .card strong {
    font-size: 14px;
    font-weight: 600;
  }

  .card small {
    color: rgb(255 255 255 / 0.53);
    font-size: 11px;
  }

  .prose {
    margin: 0;
    color: rgb(255 255 255 / 0.87);
    font-size: 12px;
    line-height: 18px;
    white-space: pre-line;
  }

  .links {
    display: flex;
    gap: 14px;
  }

  .link {
    padding: 0;
    border: 0;
    background: none;
    color: var(--accent);
    font-size: 11px;
    text-decoration: none;
    cursor: pointer;
  }

  .licence {
    align-self: flex-end;
    color: var(--accent);
    font-size: 10.5px;
    text-decoration: none;
    opacity: 0.7;
  }

  /* The article runs beside the photograph or the logo, and on under it at the card's full width. */
  .flow {
    display: flow-root;
  }

  .flow strong,
  .flow small {
    display: block;
  }

  .flow small {
    margin-top: 3px;
  }

  .flow small.quiet {
    color: rgb(255 255 255 / 0.7);
  }

  .flow .prose {
    margin-top: 8px;
  }

  .photo {
    display: grid;
    float: left;
    width: 112px;
    height: 148px;
    margin: 0 14px 6px 0;
    overflow: hidden;
    place-items: center;
    border-radius: 6px;
    background: rgb(255 255 255 / 0.15);
    color: rgb(255 255 255 / 0.3);
    font-size: 30px;
  }

  .photo img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    object-position: top;
  }

  .logo {
    float: right;
    max-width: 112px;
    max-height: 96px;
    margin: 0 0 6px 14px;
    object-fit: contain;
  }

  .card-links {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 14px;
  }

  .dots {
    display: flex;
    gap: 2px;
    justify-content: center;
    margin-top: 2px;
  }

  .dots button {
    width: 18px;
    height: 18px;
    padding: 0;
    border: 0;
    background: none;
    cursor: pointer;
  }

  .dots button::before {
    display: block;
    width: 6px;
    height: 6px;
    margin: auto;
    border-radius: 50%;
    background: rgb(255 255 255 / 0.3);
    content: '';
  }

  .dots button.on::before {
    background: #fff;
  }

  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .chips span {
    padding: 3px 10px;
    border-radius: 12px;
    background: rgb(255 255 255 / 0.18);
    font-size: 11px;
  }

  .members {
    display: flex;
    flex-flow: row wrap;
    gap: 14px 10px;
    justify-content: center;
  }

  .elsewhere {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .elsewhere a {
    display: flex;
    gap: 8px;
    align-items: baseline;
    padding: 5px 10px;
    border-radius: 6px;
    background: rgb(255 255 255 / 0.094);
    color: #fff;
    font-size: 11px;
    text-decoration: none;
  }

  @media (hover: hover) {
    .elsewhere a:hover {
      background: rgb(255 255 255 / 0.18);
    }
  }

  .elsewhere b {
    flex: none;
    font-weight: 400;
  }

  .elsewhere span {
    overflow: hidden;
    opacity: 0.6;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
