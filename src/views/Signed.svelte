<script lang="ts">
  // What a signed-in person sees until the shell of Phase 1 replaces it: their account and their
  // cloud space, read from the service.
  import { cloud, session } from '../app';
  import type { CloudQuota } from '../api/wire';
  import { text } from '../strings/loc';

  let quota = $state<CloudQuota | null>(null);
  let failed = $state(false);

  async function load() {
    failed = false;
    try {
      quota = await cloud.quota();
    } catch {
      failed = true;
    }
  }

  void load();

  const gigabytes = (bytes: number) => (bytes / 1e9).toFixed(1);
</script>

<main>
  <h1>rpm</h1>
  <p>{session.user?.displayName || session.user?.email}</p>
  {#if failed}
    <p class="error">{text('Rpm_Profile_QuotaUnknown')}</p>
    <button class="glass-button" onclick={load}>{text('Rpm_Library_Retry')}</button>
  {:else if quota}
    <p>{text('Rpm_Profile_Storage')}: {gigabytes(quota.usedBytes)} / {gigabytes(quota.quotaBytes)} GB</p>
  {/if}
  <button class="glass-button" onclick={() => session.signOut()}>{text('Login_SignOut')}</button>
</main>

<style>
  main {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 12px;
    padding: max(24px, env(safe-area-inset-top)) 24px;
  }

  h1 {
    margin: 0;
    font: 400 44px/1 Thiamine, Cabin, sans-serif;
    color: rgb(255 255 255 / 0.5);
  }

  p {
    margin: 0;
  }

  .error {
    color: var(--error);
  }
</style>
