<script lang="ts">
  // Settings, as the desktop's window has them: a rail beside a page. Only the pages the web app has are on
  // the rail. On a phone the same pages stand under the Account tab.
  import { byteSize } from '../../library/bytes';
  import { onDestroy } from 'svelte';

  import { avatarBytes, type Profile } from '../../api/profile';
  import type { DiscogsStatus } from '../../api/session';
  import type { CloudQuota } from '../../api/wire';
  import { cloud, profiles, session, streamQuality } from '../../app';
  import { offerFor, ORIGINAL, settles } from '../../audio/ladder';
  import { BACKDROPS, backdrop, effectiveId } from '../../design/backdrop.svelte';
  import { icons } from '../../design/icons';
  import { crashConsent, setCrashConsent } from '../../report/report';
  import { currentLanguage, LANGUAGES, setLanguage, text } from '../../strings/loc';
  import Equalizer from '../deck/Equalizer.svelte';
  import BecomeSupporter from './BecomeSupporter.svelte';
  import SupporterBadge from './SupporterBadge.svelte';

  type Page = 'profile' | 'display' | 'sound' | 'cloud' | 'catalog';

  const PAGES: [Page, string, string][] = [
    ['profile', icons.artist, 'Settings_Profile'],
    ['display', icons.palette, 'Settings_Display'],
    ['sound', icons.volume, 'Settings_Sound'],
    ['cloud', icons.cloud, 'Settings_Cloud'],
    ['catalog', icons.book, 'Settings_Catalog'],
  ];

  let page = $state<Page>('profile');
  let quota = $state<CloudQuota | null>(null);
  let quotaFailed = $state(false);

  const user = session.user;
  const supporter = user?.supporter === true;

  // The streaming quality, as the phones offer it: the original and the ladder below it for a supporter or tester,
  // the one rate a free account is served, shown greyed out with its reason beside it.
  const offer = offerFor(user ? user.supporter : null);
  let quality = $state(settles(offer, streamQuality.choice));
  const rateName = (kilobits: number) => (kilobits === ORIGINAL ? text('Rpm_Playback_Original') : text('Rpm_Profile_QualityKbps', kilobits));

  // The public profile: the name and the picture shown beside reviews and on shared shelves.
  let profile = $state.raw<Profile | null>(null);
  let picture = $state<string | null>(null);
  let name = $state('');
  let nameNote = $state('');
  let pictureNote = $state('');
  let workingName = $state(false);
  let workingPicture = $state(false);

  const showProfile = async (read: Profile) => {
    profile = read;
    name = read.displayName;
    picture = await profiles.picture(read);
  };
  profiles.mine().then(showProfile, () => {});

  const initial = $derived((profile?.displayName || user?.displayName || user?.email || '?').charAt(0).toUpperCase());
  const shownName = $derived(profile?.displayName || user?.displayName || '');

  async function saveName(event: SubmitEvent) {
    event.preventDefault();
    workingName = true;
    nameNote = '';
    const outcome = await profiles.rename(name);
    workingName = false;
    if (outcome === 'saved') {
      nameNote = text('Profile_NameSaved');
      await profiles.mine().then(showProfile, () => {});
    } else {
      nameNote = text(outcome === 'taken' ? 'Profile_NameTaken' : outcome === 'invalid' ? 'Profile_NameInvalid' : 'Web_EditFailed');
    }
  }

  async function choosePicture(file: File | undefined) {
    if (!file) return;
    workingPicture = true;
    pictureNote = '';
    try {
      await showProfile(await profiles.setAvatar(await avatarBytes(file)));
    } catch {
      pictureNote = text('Profile_PictureFailed');
    } finally {
      workingPicture = false;
    }
  }

  async function removePicture() {
    workingPicture = true;
    pictureNote = '';
    try {
      await showProfile(await profiles.clearAvatar());
    } catch {
      pictureNote = text('Web_EditFailed');
    } finally {
      workingPicture = false;
    }
  }

  // The backdrop row: rpm's own pictures, the listener's own picture when there is one, and the picker.
  let backdropNote = $state('');
  const chosenBackdrop = $derived(backdrop.own ? null : effectiveId(backdrop.id, supporter));

  async function pickBackdrop(id: string, supporters: boolean | undefined) {
    backdropNote = '';
    if (supporters && !supporter) {
      backdropNote = text('Supporters_Backdrop');
      return;
    }
    await backdrop.pick(id);
  }

  async function ownBackdrop(file: File | undefined) {
    backdropNote = '';
    if (file && !(await backdrop.pickOwn(file))) backdropNote = text('Profile_PictureFailed');
  }

  cloud
    .quota()
    .then((answer) => (quota = answer))
    .catch(() => (quotaFailed = true));

  let discogs = $state<DiscogsStatus | null>(null);
  const readDiscogs = () => session.discogsStatus().then((status) => (discogs = status));
  void readDiscogs();
  const channel = new BroadcastChannel('rpm-discogs');
  channel.onmessage = () => void readDiscogs();
  onDestroy(() => channel.close());

  const sendCrashes = crashConsent();

  // The Stripe portal opens in this tab. Only a failure, or an account with no subscription, is said here.
  let managing = $state(false);
  let manageNote = $state<'' | 'Supporter_NoSubscription' | 'Supporter_CheckoutFailed'>('');

  async function manage() {
    managing = true;
    manageNote = '';
    const outcome = await session.manageSubscription();
    if (outcome === 'none') manageNote = 'Supporter_NoSubscription';
    else if (outcome === 'failed') manageNote = 'Supporter_CheckoutFailed';
    managing = false;
  }

  let deleting = $state(false);
  let typed = $state('');
  let busy = $state(false);
  let refusal = $state('');

  async function deleteAccount(event: SubmitEvent) {
    event.preventDefault();
    busy = true;
    refusal = '';
    if (!(await session.deleteAccount(typed))) refusal = text('Web_DeleteAccountFailed');
    busy = false;
  }

  async function connectDiscogs() {
    const tab = window.open('', '_blank');
    const address = await session.startDiscogs();
    if (address && tab) tab.location.href = address;
    else tab?.close();
  }

  async function disconnectDiscogs() {
    if (await session.disconnectDiscogs()) await readDiscogs();
  }

  const human = byteSize;

  // Within this of the limit is almost full, as CloudSpace.AlmostFullBytes on the desktop.
  const ALMOST_FULL = 2 * 2 ** 30;
  const share = $derived(quota && !quota.unlimited && quota.quotaBytes > 0 ? Math.min(100, (quota.usedBytes / quota.quotaBytes) * 100) : 0);
  const usage = $derived.by(() => {
    if (!quota) return '';
    if (quota.unlimited) return text('Cloud_UsageUnlimited', human(quota.usedBytes));
    if (quota.quotaBytes <= 0) return text('Rpm_Profile_StorageUnknown');
    const key = quota.usedBytes >= quota.quotaBytes ? 'Cloud_UsageFull' : quota.quotaBytes - quota.usedBytes < ALMOST_FULL ? 'Cloud_UsageAlmostFull' : 'Cloud_Usage';
    return text(key, human(quota.usedBytes), human(quota.quotaBytes));
  });
  const nearlyFull = $derived(!!quota && !quota.unlimited && quota.quotaBytes > 0 && quota.usedBytes < quota.quotaBytes && quota.quotaBytes - quota.usedBytes < ALMOST_FULL);
  const standing = user?.tester ? 'Cloud_SupporterTester' : user?.supporter ? 'Cloud_SupporterYes' : 'Cloud_SupporterFree';
</script>

<div class="settings">
  <div class="rail" role="tablist" aria-label={text('Settings_Title')}>
    {#each PAGES as [id, glyph, label]}
      <button role="tab" aria-selected={page === id} class:on={page === id} onclick={() => (page = id)}><i class="icon">{glyph}</i>{text(label)}</button>
    {/each}
  </div>

  <div class="page">
    {#if page === 'profile'}
      <div class="head">
        <h3>{text('Settings_Profile')}</h3>
        <p>{text('Rpm_Profile_Subtitle')}</p>
      </div>

      <section class="card">
        <h4><i class="icon">{icons.artist}</i>{text('Rpm_Profile_Account')}</h4>
        <div class="who">
          <span class="avatar">{#if picture}<img src={picture} alt="" />{:else}{initial}{/if}</span>
          <div class="identity">
            <p class="name">{shownName}{#if supporter && !user?.tester}<SupporterBadge />{/if}</p>
            <p class="dim">{user?.email}</p>
            <p class="dim">{text('Profile_WallDetail')}</p>
          </div>
        </div>
        {#if profile}
          <form class="named" onsubmit={saveName}>
            <label class="dim" for="display-name">{text('Profile_DisplayName')}</label>
            <div class="row">
              <input id="display-name" class="field" maxlength="40" bind:value={name} oninput={() => (nameNote = '')} />
              <button class="glass-button" type="submit" disabled={workingName || name.trim() === profile.displayName || name.trim().length < 2}><i class="icon">{icons.save}</i>{text('Details_Save')}</button>
            </div>
            {#if nameNote}<p class="dim" role="status">{nameNote}</p>{/if}
          </form>
          <div class="row">
            <label class="glass-button" class:off={workingPicture}>
              <i class="icon">{icons.image}</i>{text('Profile_ChoosePicture')}
              <input type="file" accept="image/jpeg,image/png,image/webp" hidden onchange={(event) => choosePicture(event.currentTarget.files?.[0])} />
            </label>
            {#if profile.hasAvatar}
              <button class="glass-button" disabled={workingPicture} onclick={removePicture}><i class="icon">{icons.trash}</i>{text('Profile_RemovePicture')}</button>
            {/if}
            {#if pictureNote}<p class="refusal" role="alert">{pictureNote}</p>{/if}
          </div>
        {/if}
        <div class="rule"></div>
        <div class="row">
          <button class="glass-button" onclick={() => session.signOut()}><i class="icon">{icons.signOut}</i> {text('Rpm_Profile_SignOut')}</button>
          <button class="glass-button danger" onclick={() => (deleting = !deleting)}><i class="icon">{icons.trash}</i> {text('Account_Delete')}</button>
        </div>
        {#if deleting}
          <p class="dim">{text('Account_DeleteBody')}</p>
          <p class="dim">{text('Account_DeleteTypeEmail', user?.email ?? '')}</p>
          <form onsubmit={deleteAccount}>
            <input class="field" type="email" autocomplete="off" aria-label={text('Login_Email')} bind:value={typed} />
            <button class="glass-button danger" type="submit" disabled={busy || typed.trim().toLowerCase() !== user?.email.toLowerCase()}>{text('Account_Delete')}</button>
          </form>
          {#if refusal}<p class="refusal" role="alert">{refusal}</p>{/if}
        {/if}
      </section>

      <section class="card">
        <h4><i class="icon">{icons.heart}</i>{text('Rpm_Profile_Plan')}</h4>
        {#if user?.tester}
          <p class="plan">{text('Rpm_Profile_PlanTester')}</p>
          <p class="dim">{text('Rpm_Profile_PlanTesterDetail')}</p>
          <p class="dim thanks">{text('Rpm_Profile_PlanTesterThanks')}</p>
          <div class="row"><BecomeSupporter kind="glass-button" /></div>
        {:else if supporter}
          <SupporterBadge />
          <p class="dim">{text('Rpm_Profile_PlanSupporterDetail')}</p>
          <p class="dim thanks">{text('Rpm_Profile_PlanSupporterThanks')}</p>
          <div class="row"><button class="glass-button" type="button" disabled={managing} onclick={manage}>{text('Supporter_Manage')}</button></div>
          {#if manageNote}<p class="dim" role="status">{text(manageNote)}</p>{/if}
        {:else}
          <p class="plan">{text('Rpm_Profile_PlanFree')}</p>
          <p class="dim">{text('Rpm_Profile_PlanFreeDetail')}</p>
          <p class="dim thanks">{text('Rpm_Profile_PlanFreeAppeal')}</p>
          <div class="row"><BecomeSupporter kind="glass-button" /></div>
        {/if}
      </section>

      <section class="card">
        <h4><i class="icon">{icons.warning}</i>{text('Settings_CrashReports')}</h4>
        <label class="tick"><input type="checkbox" checked={sendCrashes} onchange={(event) => setCrashConsent(event.currentTarget.checked)} /> {text('Settings_CrashReportsDesc')}</label>
      </section>
    {:else if page === 'display'}
      <div class="head"><h3>{text('Settings_Display')}</h3></div>
      <section class="card">
        <h4><i class="icon">{icons.palette}</i>{text('Tv_Setup_Language')}</h4>
        <select class="field" aria-label={text('Tv_Setup_Language')} value={currentLanguage()} onchange={(event) => setLanguage(event.currentTarget.value)}>
          {#each LANGUAGES as [code, name]}<option value={code}>{name}</option>{/each}
        </select>
      </section>
      <section class="card">
        <h4><i class="icon">{icons.image}</i>{text('Settings_Background')}</h4>
        <p class="dim">{text('Settings_BackgroundHint')}</p>
        <div class="tiles">
          {#each BACKDROPS as choice (choice.id)}
            <button class="tile" class:chosen={chosenBackdrop === choice.id} aria-pressed={chosenBackdrop === choice.id} onclick={() => pickBackdrop(choice.id, choice.supporters)}>
              <span class="frame" style:background-image="url({choice.tile})">
                {#if choice.supporters && !supporter}<span class="mark"><i class="icon">{icons.heart}</i></span>{/if}
              </span>
              <span class="caption">{text(choice.label)}</span>
            </button>
          {/each}
          {#if backdrop.own}
            <span class="tile chosen" aria-current="true">
              <span class="frame" style:background-image="url({backdrop.own})"></span>
              <span class="caption">{text('Settings_BackgroundYours')}</span>
            </span>
          {/if}
          <label class="tile">
            <span class="frame plus"><i class="icon">{icons.plus}</i></span>
            <span class="caption">{text('Settings_ChooseImage')}</span>
            <input type="file" accept="image/jpeg,image/png,image/webp" hidden onchange={(event) => ownBackdrop(event.currentTarget.files?.[0])} />
          </label>
        </div>
        {#if backdropNote}<p class="dim" role="status">{backdropNote}</p>{/if}
      </section>
    {:else if page === 'sound'}
      <div class="head"><h3>{text('Settings_Sound')}</h3></div>
      <section class="card">
        <h4><i class="icon">{icons.volume}</i>{text('Rpm_Profile_Playback')}</h4>
        <label class="named">
          <span class="dim">{text('Atv_SettingsQuality')}</span>
          <select class="field quality" disabled={offer.capped} bind:value={quality} onchange={() => streamQuality.choose(quality)}>
            {#each offer.rungs as rung (rung)}<option value={rung}>{rateName(rung)}</option>{/each}
          </select>
        </label>
        {#if offer.capped}
          <p class="dim">{text('Rpm_Profile_QualityCapped')}</p>
          <div class="row"><BecomeSupporter kind="glass-button" /></div>
        {/if}
        <p class="dim">{text('Web_QualityDetail')}</p>
      </section>
      <section class="card"><Equalizer /></section>
    {:else if page === 'cloud'}
      <div class="head"><h3>{text('Settings_Cloud')}</h3></div>
      <section class="card">
        <h4><i class="icon">{icons.cloud}</i>{text('Rpm_Profile_Storage')}</h4>
        {#if quota}
          <p>{usage}</p>
          {#if !quota.unlimited}<div class="bar" class:full={share >= 100}><span style:width="{share}%"></span></div>{/if}
          <p class="dim">{quota.fileCount === 1 ? text('Rpm_Profile_TracksOne') : text('Rpm_Profile_StorageTracks', quota.fileCount)}</p>
          {#if nearlyFull}<p class="warn">{text('Cloud_AlmostFullHint', human(ALMOST_FULL))}</p>{/if}
        {:else if quotaFailed}
          <p class="dim">{text('Rpm_Profile_QuotaUnknown')}</p>
        {/if}
        <div class="rule"></div>
        <div class="standing">
          {#if supporter && !user?.tester}<SupporterBadge />{/if}
          <p class="dim">{text(standing)}</p>
        </div>
        {#if !supporter}
          <div class="row"><BecomeSupporter kind="glass-button" /></div>
        {/if}
      </section>
    {:else}
      <div class="head"><h3>{text('Settings_Catalog')}</h3></div>
      <section class="card">
        <h4><i class="icon">{icons.book}</i>Discogs</h4>
        {#if discogs?.configured}
          <p class="dim">{discogs.connected ? text('Catalog_DiscogsConnectedAs', discogs.username ?? '') : text('Catalog_DiscogsNotConnected')}</p>
          <div class="row">
            {#if discogs.connected}
              <button class="glass-button" onclick={disconnectDiscogs}>{text('Catalog_DiscogsDisconnect')}</button>
            {:else}
              <button class="glass-button" onclick={connectDiscogs}>{text('Catalog_DiscogsConnect')}</button>
            {/if}
          </div>
        {/if}
      </section>
    {/if}
  </div>
</div>

<style>
  .settings {
    display: grid;
    grid-template-columns: 190px minmax(0, 1fr);
    gap: 10px;
    min-height: 460px;
  }

  .rail {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding-right: 10px;
    border-right: 1px solid var(--hairline);
  }

  .rail button {
    display: flex;
    gap: 10px;
    align-items: center;
    padding: 8px 10px;
    border: 0;
    border-radius: 8px;
    background: none;
    color: #fff;
    font: inherit;
    font-size: 14px;
    text-align: left;
    cursor: pointer;
  }

  .rail button .icon {
    width: 16px;
    font-size: 14px;
    text-align: center;
  }

  .rail button:hover {
    background: rgb(21 28 40 / 0.35);
  }

  .rail button.on {
    background: rgb(3 113 208 / 0.14);
  }

  .page {
    display: flex;
    flex-direction: column;
    gap: 24px;
    min-width: 0;
    padding: 0 20px;
  }

  .head {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  h3 {
    margin: 0;
    color: #fff;
    font-size: 22px;
    font-weight: 600;
  }

  .head p {
    color: rgb(255 255 255 / 0.6);
  }

  .card {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 18px;
    border: 1px solid rgb(255 255 255 / 0.12);
    border-radius: 8px;
    background: rgb(0 0 0 / 0.2);
  }

  h4 {
    display: flex;
    gap: 10px;
    align-items: center;
    margin: 0;
    color: #fff;
    font-size: 15px;
    font-weight: 600;
  }

  h4 .icon {
    color: rgb(255 255 255 / 0.4);
    font-size: 12px;
  }

  p {
    margin: 0;
    font-size: 13px;
  }

  .dim {
    color: rgb(255 255 255 / 0.53);
    font-size: 12px;
  }

  .who {
    display: flex;
    gap: 14px;
    align-items: center;
  }

  .avatar {
    display: grid;
    flex: none;
    place-items: center;
    width: 72px;
    height: 72px;
    overflow: hidden;
    border-radius: 50%;
    background: rgb(4 200 255 / 0.15);
    color: #04c8ff;
    font-size: 28px;
    font-weight: 600;
  }

  .avatar img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .identity {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .name {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
    color: #fff;
    font-size: 17px;
  }

  /* The caption above, and the field and its key on one line at the key's height. */
  label.named {
    display: flex;
    flex-direction: column;
    gap: 4px;
    align-items: flex-start;
  }

  form.named {
    flex-direction: column;
    gap: 4px;
    align-items: flex-start;
  }

  .field.quality {
    width: 220px;
    height: 32px;
    font-size: 13px;
  }

  .named .field {
    width: 220px;
    height: 32px;
    font-size: 13px;
  }

  .plan {
    color: #fff;
    font-size: 17px;
  }

  .thanks {
    margin-top: 6px;
  }

  .warn {
    color: var(--warning);
    font-size: 12px;
  }

  .standing {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  label.glass-button.off {
    opacity: 0.45;
    pointer-events: none;
  }

  .tiles {
    display: flex;
    gap: 12px;
    padding-bottom: 6px;
    overflow-x: auto;
  }

  .tile {
    display: flex;
    flex: none;
    flex-direction: column;
    gap: 6px;
    align-items: center;
    padding: 0;
    border: 0;
    background: none;
    color: inherit;
    font: inherit;
    cursor: pointer;
  }

  .frame {
    position: relative;
    display: grid;
    place-items: center;
    box-sizing: border-box;
    width: 132px;
    height: 82px;
    border: 1px solid rgb(255 255 255 / 0.12);
    border-radius: 8px;
    background-color: rgb(0 0 0 / 0.133);
    background-position: center;
    background-size: cover;
  }

  .tile.chosen .frame {
    border: 2px solid var(--accent);
  }

  .frame.plus .icon {
    font-size: 18px;
  }

  .mark {
    position: absolute;
    top: 5px;
    right: 5px;
    padding: 2px 5px;
    border-radius: 7px;
    background: rgb(0 0 0 / 0.6);
    color: var(--accent);
    font-size: 9px;
  }

  .caption {
    color: rgb(255 255 255 / 0.67);
    font-size: 11px;
  }

  .tile.chosen .caption {
    color: var(--accent);
  }

  .rule {
    height: 1px;
    background: rgb(255 255 255 / 0.1);
  }

  .row,
  form {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    align-items: center;
  }

  .danger {
    color: var(--error);
  }

  .refusal {
    color: var(--error);
  }

  .field {
    box-sizing: border-box;
    max-width: 320px;
  }

  .tick {
    display: flex;
    gap: 8px;
    align-items: flex-start;
    font-size: 13px;
  }

  .bar {
    height: 6px;
    overflow: hidden;
    border-radius: 3px;
    background: rgb(255 255 255 / 0.12);
  }

  .bar span {
    display: block;
    height: 100%;
    background: #fff;
  }

  .bar.full span {
    background: var(--warning);
  }

  @media (max-width: 699px) {
    .settings {
      grid-template-columns: minmax(0, 1fr);
      min-height: 0;
    }

    .rail {
      flex-direction: row;
      padding: 0 0 8px;
      overflow-x: auto;
      border-right: 0;
      border-bottom: 1px solid var(--hairline);
    }

    .rail button {
      flex: none;
    }

    .page {
      padding: 0;
    }
  }
</style>
