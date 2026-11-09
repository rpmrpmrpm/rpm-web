<script lang="ts">
  import { session } from '../../app';
  import { icons } from '../../design/icons';
  import { text } from '../../strings/loc';

  // Starts paying for supporting rpm. The Stripe page opens in this tab, and Stripe's thank-you page
  // on the website links back to the web app. kind is the look of the place it sits in: a full button,
  // or a small tool link next to other text.
  let { kind }: { kind: 'glass-button' | 'tool' } = $props();

  let busy = $state(false);
  let failed = $state(false);

  async function start() {
    busy = true;
    failed = false;
    failed = !(await session.becomeSupporter());
    busy = false;
  }
</script>

<button class={kind} type="button" disabled={busy} onclick={start}>
  {#if kind === 'glass-button'}<i class="icon">{icons.heart}</i>{/if}{text('Cloud_BecomeSupporter')}
</button>
{#if failed}<p class="error" role="alert">{text('Supporter_CheckoutFailed')}</p>{/if}

<style>
  .error {
    margin: 0;
    color: var(--error);
    font-size: 13px;
  }
</style>
