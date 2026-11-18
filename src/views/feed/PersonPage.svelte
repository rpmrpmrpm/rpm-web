<script lang="ts">
  // A person's page: the top (PersonTop) with the friend keys under it on someone else's page, the post box on the
  // reader's own, and their posts and reviews. A blocked person's page shows the blocked line alone.
  import type { Person, Song } from '../../api/community';
  import { community, session } from '../../app';
  import { icons } from '../../design/icons';
  import { text } from '../../strings/loc';
  import { openMenu } from '../menu/menu.svelte';
  import Composer from './Composer.svelte';
  import { feed } from './feed.svelte';
  import type { PersonView } from './feed-pages.svelte';
  import FeedColumn from './FeedColumn.svelte';
  import PersonTop from './PersonTop.svelte';

  let { person, active }: { person: PersonView; active: boolean } = $props();

  const me = $derived(session.user?.userId ?? null);
  let busy = $state(false);

  async function change(send: () => Promise<void>, readList = false) {
    busy = true;
    await feed.change(person, send, readList);
    busy = false;
  }

  function friendsMenu(event: MouseEvent, profile: Person) {
    const key = (event.currentTarget as HTMLElement).getBoundingClientRect();
    openMenu([{ label: text('Rpm_Profile_RemoveFriend'), glyph: icons.userMinus, run: () => void change(() => community.removeFriend(profile.userId)) }], key.left, key.bottom + 4);
  }

  async function post(body: string, song: Song | null): Promise<boolean> {
    try {
      person.list?.prepend(await community.createPost(body, song));
      return true;
    } catch {
      return false;
    }
  }
</script>

{#snippet keys(profile: Person)}
  {#if profile.blocked}
    <div class="blocked">
      <p>{text('Rpm_Profile_Blocked')}</p>
      <button class="glass-button" disabled={busy} onclick={() => change(() => community.unblock(profile.userId), true)}>{text('Rpm_Profile_Unblock')}</button>
    </div>
  {:else}
    <div class="keys">
      {#if profile.friendship === 'requested'}
        <button class="glass-button" disabled={busy} onclick={() => change(() => community.removeFriend(profile.userId))}>{text('Rpm_Profile_Requested')}</button>
      {:else if profile.friendship === 'incoming'}
        <button class="glass-button primary" disabled={busy} onclick={() => change(() => community.acceptFriend(profile.userId))}>{text('Rpm_Profile_Accept')}</button>
        <button class="glass-button" disabled={busy} onclick={() => change(() => community.removeFriend(profile.userId))}>{text('Rpm_Profile_Decline')}</button>
      {:else if profile.friendship === 'friends'}
        <button class="glass-button" disabled={busy} onclick={(event) => friendsMenu(event, profile)}>{text('Rpm_Profile_Friends')}</button>
      {:else}
        <button class="glass-button primary" disabled={busy} onclick={() => change(() => community.requestFriend(profile.userId))}>{text('Rpm_Profile_AddFriend')}</button>
      {/if}
    </div>
  {/if}
{/snippet}

<FeedColumn list={person.list} {active}>
  {#snippet top()}
    {#if person.profile}
      {@const profile = person.profile}
      {#if me && profile.userId !== me}
        <PersonTop person={profile}>
          {#snippet below()}{@render keys(profile)}{/snippet}
        </PersonTop>
      {:else}
        <PersonTop person={profile} />
      {/if}
    {/if}
    {#if person.own && !person.profile?.blocked}
      <Composer prompt={text('Rpm_Profile_PostPrompt')} offerSong onSend={post} />
    {/if}
  {/snippet}
</FeedColumn>

<style>
  .keys {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    justify-content: center;
  }

  .blocked {
    display: flex;
    flex-direction: column;
    gap: 10px;
    align-items: center;
  }

  .blocked p {
    margin: 0;
    color: rgb(255 255 255 / 0.533);
    font-size: var(--feed-body);
  }
</style>
