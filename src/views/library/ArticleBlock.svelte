<script lang="ts">
  // What is known about an act or a genre: the lead of its article, shown in full, with where it came from.
  import type { Article } from '../../library/articles';
  import { text } from '../../strings/loc';

  let { heading, load, failed }: { heading: string; load: () => Promise<Article | null>; failed?: string } = $props();

  let article = $state.raw<Article | null>(null);
  let refused = $state(false);

  $effect(() => {
    const asked = load();
    let current = true;
    article = null;
    refused = false;
    asked.then(
      (found) => {
        if (current) article = found;
      },
      () => {
        if (current) refused = true;
      },
    );
    return () => {
      current = false;
    };
  });
</script>

{#if article || (refused && failed)}
  <section>
    <h3>{heading}</h3>
    <div class="card">
      {#if article}
        <strong>{article.title}</strong>
        {#each article.text.split('\n').filter(Boolean) as paragraph}<p>{paragraph}</p>{/each}
        <div class="source">
          {#if article.url}<a href={article.url} target="_blank" rel="noopener">{text('TrackInfo_ReadOnWikipedia')}</a>{/if}
          <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noopener" title={text('Wikipedia_LicenceTip')}>{text('Wikipedia_Licence')}</a>
        </div>
      {:else}
        <p>{failed}</p>
      {/if}
    </div>
  </section>
{/if}

<style>
  section {
    padding: 0 14px;
  }

  h3 {
    margin: 0 0 8px;
    color: rgb(255 255 255 / 0.8);
    font-size: 12.5px;
    font-weight: 400;
  }

  .card {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 12px 14px;
    border-radius: 8px;
    background: rgb(255 255 255 / 0.08);
  }

  strong {
    font-size: 14px;
    font-weight: 600;
  }

  p {
    margin: 0;
    color: rgb(255 255 255 / 0.85);
    font-size: 12.5px;
    line-height: 1.55;
  }

  .source {
    display: flex;
    gap: 14px;
  }

  a {
    color: rgb(255 255 255 / 0.55);
    font-size: 11px;
  }
</style>
