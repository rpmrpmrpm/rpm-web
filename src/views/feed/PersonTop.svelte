<script lang="ts">
  // The top of a person's page, as on the phones: the banner, the photo over its foot (a gold ring for a supporter),
  // the name with the supporter's heart, the badge, the size of the collection, when they joined, and what they
  // are playing. What stands under it (the friend keys, or the blocked line) comes from the page.
  import type { Snippet } from 'svelte';

  import type { Person } from '../../api/community';
  import { artistArt, faces } from '../../app';
  import { icons } from '../../design/icons';
  import { badgeOf } from '../../social/badges';
  import { grouped, monthAndYear } from '../../social/written';
  import { text } from '../../strings/loc';
  import BadgePill from './BadgePill.svelte';
  import Face from './Face.svelte';
  import { songLine } from './parts';

  let { person, below }: { person: Person; below?: Snippet } = $props();

  let banner = $state<string | null>(null);

  // The uploaded banner, or the photo of the artist the person is playing when they chose that. Nothing playing
  // leaves the plate plain, as on the phones.
  $effect(() => {
    const shown = person;
    let current = true;
    banner = null;
    const found = shown.bannerFollowsListening
      ? shown.listening?.artist
        ? artistArt.photo(shown.listening.artist)
        : Promise.resolve(null)
      : shown.hasBanner
        ? faces.banner(shown.userId, shown.bannerUpdatedAt)
        : Promise.resolve(null);
    void found.then((url) => {
      if (current) banner = url;
    });
    return () => {
      current = false;
    };
  });

  const badge = $derived(badgeOf(person.badge));

  // "1,610 albums, 23,329 tracks". Nothing when the person's app has not sent its counts.
  const counts = $derived.by(() => {
    const held = person.counts;
    if (!held || held.albums <= 0) return null;
    const albums = held.albums === 1 ? text('Stats_AlbumsOne') : text('Stats_Albums', grouped(held.albums));
    const tracks = held.tracks === 1 ? text('Rpm_Profile_TracksOne') : text('Rpm_Queue_Count', grouped(held.tracks));
    return text('Rpm_Library_CountsJoin', albums, tracks);
  });
</script>

<div class="top">
  <div class="plates">
    <div class="banner">{#if banner}<img src={banner} alt="" />{/if}</div>
    <span class="photo">
      <Face userId={person.userId} hasAvatar={person.hasAvatar} stamp={person.avatarUpdatedAt} name={person.displayName} size={120} ring={person.supporter ? 'gold' : 'plain'} />
    </span>
  </div>

  <p class="name" class:gold={person.supporter}>
    <span>{person.displayName}</span>
    {#if person.supporter}<i class="icon">{icons.heart}</i>{/if}
  </p>
  {#if badge}<div class="badge"><BadgePill name={text(badge.name)} colour={person.badgeColour} /></div>{/if}
  {#if counts}<p class="counts">{counts}</p>{/if}
  {#if person.createdAt > 0}<p class="since">{text('Rpm_Profile_MemberSince', monthAndYear(person.createdAt))}</p>{/if}
  {#if person.listening}
    <p class="playing"><i class="icon">{icons.play}</i><span>{songLine(person.listening)}</span></p>
  {/if}
  {#if below}<div class="below">{@render below()}</div>{/if}
</div>

<style>
  .top {
    display: flex;
    flex-direction: column;
    align-items: center;
    margin-bottom: 4px;
    text-align: center;
  }

  /* The photo's centre stands 14 above the banner's foot: 150 of banner, then half the photo less 14. */
  .plates {
    position: relative;
    align-self: stretch;
    height: calc(150px + 60px - 14px);
  }

  .banner {
    height: 150px;
    overflow: hidden;
    border-radius: 12px;
    background: rgb(255 255 255 / 0.078);
  }

  .banner img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .photo {
    position: absolute;
    bottom: 0;
    left: 50%;
    transform: translateX(-50%);
  }

  p {
    margin: 0;
  }

  .name {
    display: flex;
    gap: 8px;
    align-items: center;
    justify-content: center;
    max-width: 100%;
    margin-top: 8px;
    color: #fff;
    font-size: var(--feed-title);
    font-weight: 600;
  }

  .name span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .name.gold {
    color: var(--feed-gold);
  }

  .name .icon {
    font-size: 16px;
  }

  .badge {
    margin-top: 6px;
  }

  .counts,
  .since {
    color: rgb(255 255 255 / 0.533);
    font-size: var(--feed-meta);
  }

  .counts {
    margin-top: 6px;
    font-weight: 600;
  }

  .playing {
    display: flex;
    gap: 10px;
    align-items: center;
    justify-content: center;
    max-width: 100%;
    margin: 16px 0 4px;
    color: rgb(255 255 255 / 0.933);
    font-size: var(--feed-body);
  }

  .playing .icon {
    color: #fff;
    font-size: 11px;
  }

  .playing span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .below {
    margin-top: 12px;
  }
</style>
