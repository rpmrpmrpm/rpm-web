<script lang="ts">
  // The account: who is signed in, the space used, the language, and the way out. The phone apps' Profile,
  // and a pane on a computer.
  import { onDestroy, untrack } from 'svelte';

  import type { DiscogsStatus } from '../../api/session';
  import type { CloudQuota } from '../../api/wire';
  import { cloud, PRIVACY, session, TERMS } from '../../app';
  import { crashConsent, setCrashConsent } from '../../report/report';
  import { currentLanguage, LANGUAGES, setLanguage, text } from '../../strings/loc';
  import Feedback from './Feedback.svelte';

  let { startOn = 'account' }: { startOn?: 'account' | 'feedback' } = $props();

  let view = $state(untrack(() => startOn));
  let quota = $state<CloudQuota | null>(null);
  let quotaFailed = $state(false);

  const user = session.user;
  const version: string | undefined = import.meta.env.VITE_RPM_VERSION;

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

<div class="profile">
  {#if view === 'feedback'}
    <Feedback onBack={() => (view = 'account')} />
  {:else}
    <h2 class="heading">{text('Rpm_Profile_Account')}</h2>

    <section>
      <p class="strong">{user?.displayName}</p>
      <p class="soft">{user?.email}</p>
    </section>

    <section>
      <h3>{text('Rpm_Profile_Plan')}</h3>
      <p>{text(plan)}</p>
      <p class="soft">{text(planDetail)}</p>
    </section>

    <section>
      <h3>{text('Rpm_Profile_Storage')}</h3>
      {#if quota}
        <p>{quota.unlimited ? gigabytes(quota.usedBytes) : `${gigabytes(quota.usedBytes)} / ${gigabytes(quota.quotaBytes)}`}</p>
        {#if !quota.unlimited}<div class="bar"><span style:width="{share}%"></span></div>{/if}
        <p class="soft">{quota.fileCount === 1 ? text('Rpm_Profile_TracksOne') : text('Rpm_Profile_StorageTracks', quota.fileCount)}</p>
      {:else if quotaFailed}
        <p class="soft">{text('Rpm_Profile_QuotaUnknown')}</p>
      {/if}
    </section>

    <section>
      <h3>{text('Tv_Setup_Language')}</h3>
      <select class="field" aria-label={text('Tv_Setup_Language')} value={currentLanguage()} onchange={(event) => setLanguage(event.currentTarget.value)}>
        {#each LANGUAGES as [code, name]}
          <option value={code}>{name}</option>
        {/each}
      </select>
    </section>

    {#if discogs?.configured}
      <section>
        <h3>Discogs</h3>
        <p class="soft">{discogs.connected ? text('Catalog_DiscogsConnectedAs', discogs.username ?? '') : text('Catalog_DiscogsNotConnected')}</p>
        <div class="row">
          {#if discogs.connected}
            <button class="glass-button" onclick={disconnectDiscogs}>{text('Catalog_DiscogsDisconnect')}</button>
          {:else}
            <button class="glass-button" onclick={connectDiscogs}>{text('Catalog_DiscogsConnect')}</button>
          {/if}
        </div>
      </section>
    {/if}

    <section class="keys">
      <button class="glass-button" onclick={() => (view = 'feedback')}>{text('Shell_Feedback')}</button>
      <button class="glass-button" onclick={() => session.signOut()}>{text('Rpm_Profile_SignOut')}</button>
    </section>

    <section>
      <h3>{text('Settings_CrashReports')}</h3>
      <label class="tick"><input type="checkbox" checked={sendCrashes} onchange={(event) => setCrashConsent(event.currentTarget.checked)} /> {text('Settings_CrashReportsDesc')}</label>
    </section>

    <section>
      <button class="link danger" onclick={() => (deleting = !deleting)}>{text('Account_DeleteTitle')}</button>
      {#if deleting}
        <p class="soft">{text('Account_DeleteBody')}</p>
        <p class="soft">{text('Account_DeleteTypeEmail', user?.email ?? '')}</p>
        <form onsubmit={deleteAccount}>
          <input class="field" type="email" autocomplete="off" aria-label={text('Login_Email')} bind:value={typed} />
          <button class="glass-button" type="submit" disabled={busy || typed.trim().toLowerCase() !== user?.email.toLowerCase()}>{text('Account_Delete')}</button>
        </form>
        {#if refusal}<p class="refusal" role="alert">{refusal}</p>{/if}
      {/if}
    </section>

    <section class="foot">
      {#if version}<span>{text('Rpm_Profile_Version', version)}</span>{/if}
      <a class="link" href={TERMS} target="_blank" rel="noopener">{text('Shell_Terms')}</a>
      <a class="link" href={PRIVACY} target="_blank" rel="noopener">{text('Shell_Privacy')}</a>
    </section>
  {/if}
</div>

<style>
  .profile {
    display: flex;
    flex-direction: column;
    gap: 18px;
    height: 100%;
    padding: 16px;
    overflow-y: auto;
  }

  section {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  h3 {
    margin: 0 0 2px;
    color: var(--text-faint);
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }

  p {
    margin: 0;
    font-size: 13.5px;
  }

  .strong {
    font-size: 16px;
    font-weight: 700;
  }

  .soft {
    color: var(--text-soft);
    font-size: 12.5px;
  }

  .bar {
    overflow: hidden;
    height: 6px;
    margin: 4px 0 2px;
    border-radius: 3px;
    background: rgb(255 255 255 / 0.12);
  }

  .bar span {
    display: block;
    height: 100%;
    background: rgb(255 255 255 / 0.7);
  }

  .keys {
    flex-direction: row;
    flex-wrap: wrap;
    gap: 10px;
  }

  .row {
    display: flex;
    margin-top: 4px;
  }

  .tick {
    font-size: 12.5px;
  }

  form {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  form .field {
    flex: 1 1 200px;
  }

  .refusal {
    color: var(--error);
  }

  .danger {
    align-self: flex-start;
    color: var(--error);
  }

  .foot {
    flex-direction: row;
    flex-wrap: wrap;
    gap: 6px 16px;
    margin-top: auto;
    color: var(--text-faint);
    font-size: 12px;
  }
</style>
