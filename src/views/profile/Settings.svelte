<script lang="ts">
  // Settings, as the desktop's window has them: a rail beside a page. Only the pages the web app has are on
  // the rail. On a phone the same pages stand under the Account tab.
  import { onDestroy } from 'svelte';

  import type { DiscogsStatus } from '../../api/session';
  import type { CloudQuota } from '../../api/wire';
  import { cloud, session } from '../../app';
  import { icons } from '../../design/icons';
  import { crashConsent, setCrashConsent } from '../../report/report';
  import { currentLanguage, LANGUAGES, setLanguage, text } from '../../strings/loc';
  import Equalizer from '../deck/Equalizer.svelte';

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
  const initial = (user?.displayName || user?.email || '?').charAt(0).toUpperCase();

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

  const gigabytes = (bytes: number) => `${(bytes / 2 ** 30).toFixed(bytes < 2 ** 30 ? 2 : 1)} GB`;
  const share = $derived(quota && !quota.unlimited ? Math.min(100, (quota.usedBytes / quota.quotaBytes) * 100) : 0);
  const plan = user?.tester ? 'Rpm_Profile_PlanTester' : user?.supporter ? 'Rpm_Profile_PlanSupporter' : 'Rpm_Profile_PlanFree';
  const planDetail = user?.tester ? 'Rpm_Profile_PlanTesterDetail' : user?.supporter ? 'Rpm_Profile_PlanSupporterDetail' : 'Rpm_Profile_PlanFreeDetail';
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
          <span class="avatar">{initial}</span>
          <div>
            <p class="name">{user?.displayName}</p>
            <p class="dim">{user?.email}</p>
          </div>
        </div>
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
        <p>{text(plan)}</p>
        <p class="dim">{text(planDetail)}</p>
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
    {:else if page === 'sound'}
      <div class="head"><h3>{text('Settings_Sound')}</h3></div>
      <section class="card"><Equalizer /></section>
    {:else if page === 'cloud'}
      <div class="head"><h3>{text('Settings_Cloud')}</h3></div>
      <section class="card">
        <h4><i class="icon">{icons.cloud}</i>{text('Rpm_Profile_Storage')}</h4>
        {#if quota}
          <p>{quota.unlimited ? gigabytes(quota.usedBytes) : `${gigabytes(quota.usedBytes)} / ${gigabytes(quota.quotaBytes)}`}</p>
          {#if !quota.unlimited}<div class="bar"><span style:width="{share}%"></span></div>{/if}
          <p class="dim">{quota.fileCount === 1 ? text('Rpm_Profile_TracksOne') : text('Rpm_Profile_StorageTracks', quota.fileCount)}</p>
        {:else if quotaFailed}
          <p class="dim">{text('Rpm_Profile_QuotaUnknown')}</p>
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
    border-radius: 50%;
    background: rgb(4 200 255 / 0.15);
    color: #04c8ff;
    font-size: 28px;
    font-weight: 600;
  }

  .name {
    color: #fff;
    font-size: 17px;
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
