<script lang="ts">
  // The reader's edit page, as on the phones: one column of cards (display name, profile photo, banner, what the page
  // is drawn on, badge and its colour) with Save at the foot. Nothing is sent until Save. Leaving with changes asks
  // whether to apply them (Feed.back).
  import { faces } from '../../app';
  import { BADGE_COLOURS, BADGES, badgeOf } from '../../social/badges';
  import { GROUND_CHOICES, GROUND_COLOURS, groundWire, hex, type Ground } from '../../social/ground';
  import { text } from '../../strings/loc';
  import Face from './Face.svelte';
  import { feed } from './feed.svelte';
  import type { EditDraft } from './feed-pages.svelte';

  let { draft }: { draft: EditDraft } = $props();

  const person = $derived(draft.person);

  // The photo shown: the one just picked, the letter after Remove, or the stored one.
  const photo = $derived(draft.newPhoto ? draft.newPhoto.url : draft.removePhoto ? null : undefined);

  let storedBanner = $state<string | null>(null);
  $effect(() => {
    const shown = person;
    let current = true;
    storedBanner = null;
    if (shown.hasBanner)
      void faces.banner(shown.userId, shown.bannerUpdatedAt).then((url) => {
        if (current) storedBanner = url;
      });
    return () => {
      current = false;
    };
  });
  const banner = $derived(draft.bannerFollows ? null : draft.newBanner ? draft.newBanner.url : draft.removeBanner ? null : storedBanner);

  const locked = $derived(BADGES.filter((badge) => !draft.held.includes(badge.id)));
  const chosenColour = $derived(draft.colour || BADGE_COLOURS[0]!);
  const wire = $derived(groundWire(draft.ground));

  const groundOf = (id: string | null): Ground => (id === null ? { kind: 'standard' } : { kind: 'backdrop', id });

  function picked(event: Event, asBanner: boolean) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (file) void draft.pick(file, asBanner);
  }
</script>

<div class="scroll">
  <div class="column">
    <h3 class="title">{text('Rpm_Profile_EditPage')}</h3>

    <section class="card">
      <h4>{text('Rpm_Profile_Name')}</h4>
      <input class="field" maxlength="40" aria-label={text('Rpm_Profile_Name')} bind:value={draft.name} />
    </section>

    <section class="card">
      <h4>{text('Rpm_Profile_PhotoTitle')}</h4>
      <div class="photo-row">
        <Face userId={person.userId} hasAvatar={person.hasAvatar} stamp={person.avatarUpdatedAt} name={draft.name || person.displayName} size={72} picture={photo} />
        <div class="keys column-keys">
          <label class="glass-button">
            {text('Rpm_Profile_ChangePhoto')}
            <input type="file" accept="image/jpeg,image/png,image/webp" hidden onchange={(event) => picked(event, false)} />
          </label>
          <button class="glass-button" onclick={() => draft.dropPhoto()}>{text('Rpm_Profile_RemovePhoto')}</button>
        </div>
      </div>
    </section>

    <section class="card">
      <h4>{text('Rpm_Profile_BannerTitle')}</h4>
      <div class="banner">{#if banner}<img src={banner} alt="" />{/if}</div>
      <label class="choice"><input type="radio" name="banner" checked={!draft.bannerFollows} onchange={() => (draft.bannerFollows = false)} />{text('Rpm_Profile_BannerOwn')}</label>
      <label class="choice"><input type="radio" name="banner" checked={draft.bannerFollows} onchange={() => (draft.bannerFollows = true)} />{text('Rpm_Profile_BannerPlaying')}</label>
      {#if !draft.bannerFollows}
        <div class="keys">
          <label class="glass-button">
            {text('Rpm_Profile_ChooseBanner')}
            <input type="file" accept="image/jpeg,image/png,image/webp" hidden onchange={(event) => picked(event, true)} />
          </label>
          <button class="glass-button" onclick={() => draft.dropBanner()}>{text('Rpm_Profile_RemoveBanner')}</button>
        </div>
      {/if}
    </section>

    <section class="card">
      <h4>{text('Settings_Background')}</h4>
      <div class="wrap grounds">
        {#each GROUND_CHOICES.filter((choice) => !choice.supporters || person.supporter) as choice (choice.label)}
          {@const ground = groundOf(choice.id)}
          <button class="plain ground" class:picked={groundWire(ground) === wire} aria-pressed={groundWire(ground) === wire} onclick={() => (draft.ground = ground)}>
            <img src={choice.tile} alt="" />
            <span>{text(choice.label)}</span>
          </button>
        {/each}
      </div>
      <p class="label">{text('Rpm_Profile_Colours')}</p>
      <div class="wrap">
        {#each GROUND_COLOURS as rgb (rgb)}
          {@const ground: Ground = { kind: 'colour', rgb }}
          <button
            class="plain swatch big"
            class:picked={groundWire(ground) === wire}
            style:background={hex(rgb)}
            aria-label={groundWire(ground)}
            aria-pressed={groundWire(ground) === wire}
            onclick={() => (draft.ground = ground)}
          ></button>
        {/each}
      </div>
    </section>

    <section class="card">
      <h4>{text('Rpm_Badges_Title')}</h4>
      <div class="wrap">
        <button class="plain pill" class:picked={draft.badge === ''} aria-pressed={draft.badge === ''} onclick={() => (draft.badge = '')}>{text('Rpm_Badges_NoBadge')}</button>
        {#each draft.held as id (id)}
          {@const badge = badgeOf(id)}
          {#if badge}
            <button class="plain pill" class:picked={draft.badge === id} aria-pressed={draft.badge === id} onclick={() => (draft.badge = id)}>{text(badge.name)}</button>
          {/if}
        {/each}
      </div>
      <p class="label">{text('Rpm_Badges_Colour')}</p>
      <div class="wrap">
        {#each BADGE_COLOURS as colour (colour)}
          <button
            class="plain swatch"
            class:picked={chosenColour.toLowerCase() === colour.toLowerCase()}
            style:background={colour}
            aria-label={colour}
            aria-pressed={chosenColour.toLowerCase() === colour.toLowerCase()}
            onclick={() => draft.pickColour(colour)}
          ></button>
        {/each}
      </div>
      {#if locked.length}
        <p class="label locked-title">{text('Rpm_Badges_Locked')}</p>
        {#each locked as badge (badge.id)}
          <div class="locked">
            <span>{text(badge.name)}</span>
            <small>{text(badge.need)}</small>
          </div>
        {/each}
      {/if}
    </section>

    <button class="glass-button primary save" disabled={!draft.canSave} onclick={() => feed.saveEdit(draft)}>{text('Rpm_Profile_Save')}</button>
    {#if draft.trouble}<p class="trouble" role="alert">{text(draft.trouble)}</p>{/if}
  </div>
</div>

<style>
  .scroll {
    height: 100%;
    overflow-y: auto;
    overscroll-behavior: contain;
  }

  .column {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 7px 16px 40px;
  }

  .title {
    margin: 0 0 4px;
    color: #fff;
    font-size: var(--feed-subject);
    font-weight: 600;
  }

  .card {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 14px;
  }

  h4 {
    margin: 0;
    color: rgb(255 255 255 / 0.8);
    font-size: var(--feed-section);
    font-weight: 600;
  }

  .photo-row {
    display: flex;
    gap: 16px;
    align-items: center;
  }

  .keys {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .column-keys {
    flex-direction: column;
    align-items: flex-start;
  }

  .banner {
    height: 110px;
    overflow: hidden;
    border-radius: 12px;
    background: rgb(255 255 255 / 0.078);
  }

  .banner img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .choice {
    display: flex;
    gap: 8px;
    align-items: center;
    color: rgb(255 255 255 / 0.9);
    font-size: var(--feed-body);
    cursor: pointer;
  }

  .wrap {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .grounds {
    gap: 10px;
  }

  .ground {
    display: flex;
    flex-direction: column;
    gap: 6px;
    align-items: center;
    width: 70px;
    color: rgb(255 255 255 / 0.6);
    font-size: var(--feed-meta);
  }

  .ground img {
    box-sizing: border-box;
    width: 62px;
    height: 100px;
    border: 1px solid rgb(255 255 255 / 0.2);
    border-radius: 10px;
    object-fit: cover;
  }

  .ground span {
    max-width: 70px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .ground.picked {
    color: #fff;
  }

  .ground.picked img {
    border: 2px solid rgb(255 255 255 / 0.95);
  }

  .swatch {
    width: 26px;
    height: 26px;
    margin: 4px;
    border-radius: 50%;
  }

  .swatch.big {
    width: 40px;
    height: 40px;
    margin: 0;
    box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.267);
  }

  .swatch.picked {
    outline: 2px solid #fff;
    outline-offset: 2px;
  }

  .swatch.big.picked {
    outline: none;
    box-shadow: inset 0 0 0 3px rgb(255 255 255 / 0.95);
  }

  .pill {
    height: 30px;
    padding: 0 12px;
    border: 1px solid rgb(255 255 255 / 0.2);
    border-radius: 15px;
    background: rgb(255 255 255 / 0.047);
    color: rgb(255 255 255 / 0.933);
    font-size: var(--feed-body);
    font-style: italic;
  }

  .pill.picked {
    border-color: rgb(255 255 255 / 0.933);
    background: rgb(255 255 255 / 0.149);
  }

  .label {
    margin: 0;
    color: rgb(255 255 255 / 0.6);
    font-size: var(--feed-body);
  }

  .locked-title {
    margin-top: 6px;
  }

  .locked {
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .locked span {
    color: rgb(255 255 255 / 0.467);
    font-size: var(--feed-body);
    font-style: italic;
  }

  .locked small {
    color: rgb(255 255 255 / 0.4);
    font-size: var(--feed-meta);
  }

  .save {
    width: 100%;
  }

  .trouble {
    margin: 0;
    color: rgb(255 255 255 / 0.667);
    font-size: var(--feed-body);
  }
</style>
