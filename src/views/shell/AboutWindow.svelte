<script lang="ts">
  // What this is, and the version.
  import { CREDITS, HELP, WEBSITE } from '../../app';
  import { icons } from '../../design/icons';
  import { text } from '../../strings/loc';
  import Window from '../import/Window.svelte';
  import Mark from './Mark.svelte';

  let { onClose }: { onClose: () => void } = $props();

  const version: string | undefined = import.meta.env.VITE_RPM_VERSION;
</script>

<Window title={text('About_Title')} glyph={icons.info} maxWidth={520} openHeight={360} {onClose}>
  <Mark size={1.33} />
  <p>{text('About_Tagline')}</p>
  {#if version}<p>{text('About_Version', version)}</p>{/if}
  <p class="links">
    <a href={WEBSITE} target="_blank" rel="noopener">{text('About_Website')}</a>
    <a href={HELP} target="_blank" rel="noopener">{text('About_Support')}</a>
    <a href={CREDITS} target="_blank" rel="noopener">{text('About_Acknowledgements')}</a>
  </p>

  {#snippet footer()}
    <button class="glass-button" onclick={onClose}><i class="icon">{icons.close}</i>{text('About_Close')}</button>
  {/snippet}
</Window>

<style>
  p {
    margin: 0;
    font-size: 13px;
  }

  .links {
    display: flex;
    flex-wrap: wrap;
    gap: 14px;
  }

  a {
    color: inherit;
  }
</style>
