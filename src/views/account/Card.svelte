<script lang="ts">
  // The card of the desktop's dialogs: the vinyl band with the title in it, and the body below.
  import type { Snippet } from 'svelte';

  let { title, children }: { title: string; children: Snippet } = $props();
</script>

<div class="stage">
  <section class="card">
    <header>
      <h1>{title}</h1>
    </header>
    <div class="body">
      {@render children()}
    </div>
  </section>
</div>

<style>
  .stage {
    display: grid;
    place-items: center;
    min-height: 100dvh;
    padding: max(16px, env(safe-area-inset-top)) 16px max(16px, env(safe-area-inset-bottom));
    background: radial-gradient(120% 90% at 20% 0%, rgb(255 255 255 / 0.08), transparent 60%), var(--ground);
  }

  .card {
    width: min(460px, 100%);
    border: 1px solid var(--hairline);
    border-radius: 18px;
    overflow: hidden;
    background: rgb(255 255 255 / 0.1);
    backdrop-filter: blur(30px);
  }

  header {
    display: flex;
    align-items: center;
    height: 112px;
    padding: 17px 26px 3px;
    background: url('../../design/images/header-vinyl.jpg') center / cover;
  }

  /* The size at which the line of this font fills the band, as the desktop's Viewbox does. */
  h1 {
    margin: 0;
    font: 400 190px / 92px Thiamine, Cabin, sans-serif;
    color: rgb(255 255 255 / 0.5);
    white-space: nowrap;
  }

  .body {
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding: 20px 24px 24px;
  }

  @media (max-width: 420px) {
    .stage {
      place-items: stretch;
      align-content: start;
    }

    .body {
      padding: 20px 16px 20px;
    }
  }
</style>
