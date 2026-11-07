<script lang="ts">
  // Write a review (the desktop's AlbumReviewDialog): one to five stars and a review in Markdown, with a preview
  // beside it. Both are kept on this device, as the desktop keeps them.
  import { untrack } from 'svelte';

  import { albumRatings, session } from '../../app';
  import { icons } from '../../design/icons';
  import type { CloudAlbum } from '../../library/albums';
  import { readMarkdown } from '../../library/markdown';
  import { MOST_STARS } from '../../library/ratings';
  import { library } from '../../state.svelte';
  import { text } from '../../strings/loc';
  import Window from '../import/Window.svelte';

  let { album, onClose }: { album: CloudAlbum; onClose: () => void } = $props();

  const account = session.user?.userId ?? '';
  let stars = $state(0);
  let review = $state('');
  const shown = $derived(readMarkdown(review));

  void albumRatings.stars(untrack(() => album), account).then((given) => (stars = given));
  void albumRatings.review(untrack(() => album), account).then((written) => (review = written));

  async function save() {
    await albumRatings.rate(album, stars, account);
    await albumRatings.write(album, review, account);
    library.ratingsVersion++;
    onClose();
  }
</script>

<Window title={text('Review_Title')} glyph={icons.star} minWidth={560} maxWidth={900} minHeight={380} openHeight={520} {onClose}>
  <p class="record">{album.album}{album.artist ? `  ·  ${album.artist}` : ''}</p>
  <div class="rating">
    <span class="label">{text('Review_RatingLabel')}</span>
    <div class="stars" role="group" aria-label={text('Review_RatingLabel')}>
      {#each { length: MOST_STARS } as _, index}
        <button class:on={index < stars} aria-pressed={index + 1 === stars} aria-label={text(index === 0 ? 'Review_OneStar' : 'Review_Stars', index + 1)} onclick={() => (stars = index + 1)}><i class="icon">{icons.star}</i></button>
      {/each}
    </div>
    <button class="clear" type="button" onclick={() => (stars = 0)}>{text('Review_ClearRating')}</button>
  </div>
  <div class="halves">
    <label class="half">
      <span class="label">{text('Review_EditorLabel')}</span>
      <textarea class="field" spellcheck="true" placeholder={text('Review_Placeholder')} bind:value={review}></textarea>
    </label>
    <div class="half">
      <span class="label">{text('Review_PreviewLabel')}</span>
      <div class="preview">
        {#each shown as line, index (index)}
          {#if line.kind === 'blank'}
            <br />
          {:else if line.kind === 'heading'}
            <p class="heading level{line.level}">{line.parts[0]?.text}</p>
          {:else}
            <p>
              {#if line.kind === 'item'}<span class="marker">{line.marker}</span>{/if}
              {#each line.parts as part, at (at)}
                {#if part.style === 'bold'}<strong>{part.text}</strong>{:else if part.style === 'italic'}<em>{part.text}</em>{:else if part.style === 'code'}<code>{part.text}</code>{:else}{part.text}{/if}
              {/each}
            </p>
          {/if}
        {/each}
      </div>
    </div>
  </div>

  {#snippet footer()}
    <button class="glass-button" type="button" onclick={onClose}><i class="icon">{icons.close}</i>{text('Common_Cancel')}</button>
    <button class="glass-button primary" type="button" onclick={save}><i class="icon">{icons.save}</i>{text('Review_Save')}</button>
  {/snippet}
</Window>

<style>
  .record {
    margin: 0;
    color: rgb(255 255 255 / 0.6);
    font-size: 12.5px;
  }

  .rating {
    display: flex;
    gap: 12px;
    align-items: center;
  }

  .label {
    color: rgb(255 255 255 / 0.9);
    font-size: 13px;
    font-weight: 600;
  }

  .stars {
    display: inline-flex;
    gap: 4px;
  }

  .stars button {
    padding: 2px;
    border: 0;
    background: none;
    color: rgb(255 255 255 / 0.33);
    font-size: 20px;
    cursor: pointer;
  }

  .stars button.on {
    color: #f2c14e;
  }

  .clear {
    padding: 2px 6px;
    border: 0;
    background: none;
    color: rgb(255 255 255 / 0.53);
    font: inherit;
    font-size: 12px;
    cursor: pointer;
  }

  .halves {
    display: grid;
    flex: 1;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 14px;
    min-height: 200px;
  }

  .half {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-height: 0;
  }

  .half .label {
    color: rgb(255 255 255 / 0.67);
    font-size: 12px;
    font-weight: 400;
  }

  textarea {
    flex: 1;
    resize: none;
    font-size: 13px;
  }

  .preview {
    flex: 1;
    padding: 12px;
    overflow-y: auto;
    border-radius: 6px;
    background: rgb(255 255 255 / 0.1);
    color: rgb(255 255 255 / 0.93);
    font-size: 13px;
    line-height: 1.5;
  }

  .preview p {
    margin: 0;
    overflow-wrap: anywhere;
  }

  .heading {
    font-weight: 600;
  }

  .level1 {
    font-size: 20px;
  }

  .level2 {
    font-size: 17px;
  }

  .level3 {
    font-size: 15px;
  }

  .marker {
    margin-right: 10px;
  }

  code {
    font-family: Consolas, Menlo, monospace;
  }

  @media (max-width: 699px) {
    .halves {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
