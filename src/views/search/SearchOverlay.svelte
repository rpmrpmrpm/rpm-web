<script lang="ts">
  // The search bar over the whole window: one wide box near the top, in the centre, with the library search's
  // answers under it. The rest of the window is blurred a little and shaded, and a press on the shade puts the
  // search away. It is the app's one library search (librarySearch, opened from 'window'). Cmd+F (Ctrl+F off
  // Apple's devices), the deck's search key and the phone's Search tab open it (openSearchBar). The desktop app
  // has the same bar (SearchOverlay).
  //
  // The keyboard stays in the box. The first row is lit each time the rows change; Up and Down move the light,
  // Enter presses the lit row, and Escape puts the search away and gives the keyboard back to what had it.
  //
  // While the keyboard is in a pane with a search of its own (marked data-own-search: the radio, the import),
  // the key goes to that pane's field instead. While another window is up over the app (aria-modal), the key is
  // left to the browser.
  import { tick } from 'svelte';

  import { icons } from '../../design/icons';
  import { text } from '../../strings/loc';
  import type { LibraryMode } from '../library/pages.svelte';
  import { isFindKey, usesCommand } from './find-key';
  import { librarySearch } from './library-search.svelte';
  import SearchAnswers from './SearchAnswers.svelte';
  import { openSearchBar, SEARCH_BAR } from './search-bar';

  let {
    onShow,
  }: {
    // Brings up a view of the library for an answer that lives there, or makes room for a record's page.
    onShow: (where: LibraryMode | 'record') => void;
  } = $props();

  const command = usesCommand(navigator.userAgent);

  let words = $state('');
  let field = $state<HTMLInputElement | null>(null);
  let count = $state(0);
  // What had the keyboard when the bar opened, for Escape and the shade to give it back to.
  let returnTo: HTMLElement | null = null;

  const open = $derived(librarySearch.from === SEARCH_BAR);

  // Whoever opened it (the key, the deck, the tab), the bar starts empty, remembers what had the keyboard, and
  // takes it. Only on the change to open, not while it stays up.
  let wasOpen = false;
  $effect(() => {
    const isOpen = open;
    if (isOpen && !wasOpen) {
      const focused = document.activeElement;
      returnTo = focused instanceof HTMLElement && focused !== document.body ? focused : null;
      words = '';
      void tick().then(() => field?.focus());
    }
    wasOpen = isOpen;
  });

  // The first row is lit each time the rows change (new words, an answer, the recent searches); Up and Down write
  // over it.
  let lit = $derived.by(() => {
    void librarySearch.found;
    void librarySearch.showsRecent;
    return 0;
  });

  // Whether the rows on the panel belong to the words in the box now: the recent searches for an empty box, or
  // the answer found for these words.
  const answersTheBox = $derived(!librarySearch.asked.trim() || (librarySearch.found !== null && librarySearch.caughtUp));

  function keyedAnywhere(event: KeyboardEvent) {
    if (event.defaultPrevented || !isFindKey(event, command)) return;

    if (open) {
      event.preventDefault();
      field?.select();
      field?.focus();
      return;
    }

    // Another window is up over the app: the browser's own find is the one for it.
    if (document.querySelector('[aria-modal="true"]')) return;
    event.preventDefault();

    const focused = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
    const own = focused?.closest('[data-own-search]')?.querySelector<HTMLInputElement>('[data-own-search-field]');
    if (own) {
      own.focus();
      own.select();
      return;
    }

    openSearchBar();
  }

  function dismiss() {
    const back = returnTo;
    returnTo = null;
    librarySearch.close();
    if (back?.isConnected) back.focus();
  }

  function typed() {
    if (open) librarySearch.ask(words);
  }

  async function keyed(event: KeyboardEvent) {
    // A letter still being put together by an input method (Chinese, Japanese) keeps its keys.
    if (event.isComposing) return;
    if (event.key === 'Escape') {
      // The bar's Escape only: the cards and menus that close on an Escape anywhere stay as they are.
      event.preventDefault();
      event.stopPropagation();
      dismiss();
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      lit = Math.min(lit + 1, count - 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      lit = Math.max(lit - 1, 0);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      // Pressed before the typing paused, the panel still shows the words before, or the recent searches. Those
      // rows are not what is asked for, so the search runs now and the first answer to these words is pressed.
      if (!answersTheBox) {
        librarySearch.now();
        lit = 0;
        await tick();
      }
      if (open) document.querySelector<HTMLElement>('.spot .answer.lit')?.click();
    }
  }

  function chosen() {
    returnTo = null;
  }

  function again(entry: string) {
    words = entry;
    librarySearch.ask(entry);
    field?.focus();
  }

  // At the root of the page, because a pane's blur makes it the frame that fixed positions are measured from.
  function atRoot(node: HTMLElement) {
    document.body.append(node);
    return { destroy: () => node.remove() };
  }
</script>

<svelte:window onkeydown={keyedAnywhere} />

{#if open}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="shade" use:atRoot onpointerdown={dismiss}></div>
  <div class="spot" use:atRoot role="dialog" aria-label={text('Rpm_Search_Library')}>
    <div class="bar">
      <i class="icon lens">{icons.search}</i>
      <input
        bind:this={field}
        bind:value={words}
        type="text"
        enterkeyhint="search"
        autocomplete="off"
        spellcheck="false"
        placeholder={text('Rpm_Search_Library')}
        aria-label={text('Rpm_Search_Library')}
        oninput={typed}
        onkeydown={keyed}
      />
      {#if words}
        <button
          class="clear"
          title={text('Artists_SearchClear')}
          aria-label={text('Artists_SearchClear')}
          onclick={() => {
            words = '';
            librarySearch.ask('');
            field?.focus();
          }}><i class="icon">{icons.close}</i></button
        >
      {/if}
    </div>
    {#if librarySearch.showsAnything}
      <div class="panel" role="listbox" aria-label={text('Rpm_Search_Library')}>
        <SearchAnswers {onShow} onDone={chosen} onAgain={again} {lit} bind:count />
      </div>
    {/if}
  </div>
{/if}

<style>
  /* Over the panes, the deck and the heading's search panel; under a window opened over the app and the menus. The
     window behind is blurred a little and darkened, as on the desktop. */
  .shade {
    position: fixed;
    inset: 0;
    z-index: 18;
    background: rgb(0 0 0 / 0.3);
    backdrop-filter: blur(6px);
    animation: fade 140ms cubic-bezier(0.215, 0.61, 0.355, 1);
  }

  /* A seventh of the way down, and never closer to the top than 56. As wide as the window allows, up to 680. */
  .spot {
    --top: max(56px, 14dvh);
    position: fixed;
    top: var(--top);
    left: 50%;
    z-index: 19;
    display: flex;
    flex-direction: column;
    gap: 10px;
    width: min(680px, calc(100vw - 48px));
    max-height: calc(100dvh - var(--top) - 24px);
    transform: translateX(-50%);
  }

  @media (max-width: 699px) {
    .spot {
      --top: calc(env(safe-area-inset-top, 0px) + 12px);
      width: calc(100vw - 32px);
    }
  }

  /* The surface of the app's menus, as the panel under it wears, so the bar and the answers read as one thing. */
  .bar,
  .panel {
    box-sizing: border-box;
    border: 1px solid rgb(255 255 255 / 0.094);
    background: rgb(38 47 64 / 0.96);
    box-shadow: 0 8px 30px rgb(0 0 0 / 0.5);
    backdrop-filter: blur(30px);
    color: #fff;
  }

  .bar {
    display: flex;
    flex: none;
    gap: 12px;
    align-items: center;
    height: 48px;
    padding: 0 10px 0 16px;
    border-radius: 10px;
    animation:
      fade 140ms cubic-bezier(0.215, 0.61, 0.355, 1),
      drop 180ms cubic-bezier(0.215, 0.61, 0.355, 1);
  }

  .panel {
    min-height: 0;
    padding: 4px 0 10px;
    overflow-y: auto;
    overscroll-behavior: contain;
    border-radius: 8px;
    animation:
      fade 140ms cubic-bezier(0.215, 0.61, 0.355, 1),
      drop 180ms cubic-bezier(0.215, 0.61, 0.355, 1);
  }

  @keyframes fade {
    from {
      opacity: 0;
    }
  }

  @keyframes drop {
    from {
      transform: translateY(-6px);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .shade,
    .bar,
    .panel {
      animation: none;
    }
  }

  .lens {
    flex: none;
    color: rgb(255 255 255 / 0.6);
    font-size: 16px;
  }

  /* 18, above the 16 under which a phone zooms in on a field. */
  input {
    flex: 1;
    min-width: 0;
    height: 26px;
    padding: 0;
    border: 0;
    background: none;
    color: #fff;
    font-size: 18px;
    outline: none;
  }

  input::placeholder {
    color: rgb(255 255 255 / 0.47);
  }

  .clear {
    display: grid;
    flex: none;
    place-items: center;
    width: 26px;
    height: 26px;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: none;
    color: rgb(255 255 255 / 0.6);
    font-size: 11px;
    cursor: pointer;
  }

  @media (hover: hover) {
    .clear:hover {
      background: rgb(255 255 255 / 0.133);
    }
  }
</style>
