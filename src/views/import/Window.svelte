<script lang="ts">
  // A window over the app, as the desktop's ResizableDialogShell: a vinyl band with the title on it, over
  // frosted glass, with a footer that does not scroll and a grip at the corner. A whole page on a phone. The
  // sizes are those each dialog gives AttachResize, and a window opens at its widest unless it says.
  import { onMount, untrack, type Snippet } from 'svelte';

  import vinyl from '../../design/images/header-vinyl.jpg';
  import { icons } from '../../design/icons';
  import { text } from '../../strings/loc';

  let {
    title,
    glyph,
    onClose,
    minWidth = 460,
    maxWidth = 720,
    openWidth,
    minHeight = 360,
    openHeight = 560,
    children,
    footer,
    leading,
    footnote,
    banner,
  }: {
    title: string;
    glyph?: string;
    onClose: () => void;
    minWidth?: number;
    maxWidth?: number;
    openWidth?: number;
    minHeight?: number;
    openHeight?: number;
    children: Snippet;
    footer?: Snippet;
    leading?: Snippet;
    footnote?: Snippet;
    // A band across the whole window under the title, for what must be read before the form is filled in.
    banner?: Snippet;
  } = $props();

  // The title fills a box 92 high, as a Viewbox does. Thiamine's line is 0.4875 of its size, so that is this size.
  const TALLEST_TITLE = 188.7;

  let width = $state(untrack(() => openWidth ?? maxWidth));
  let height = $state(untrack(() => openHeight));

  function resize(event: PointerEvent) {
    const grip = event.currentTarget as HTMLElement;
    const [fromX, fromY, startWidth, startHeight] = [event.clientX, event.clientY, width, height];
    grip.setPointerCapture(event.pointerId);
    const move = (moved: PointerEvent) => {
      // The window stands in the middle of the page, so its corner moves half as far as it grows.
      width = Math.min(maxWidth, Math.max(minWidth, startWidth + (moved.clientX - fromX) * 2));
      height = Math.max(minHeight, startHeight + (moved.clientY - fromY) * 2);
    };
    const stop = () => {
      grip.removeEventListener('pointermove', move);
      grip.removeEventListener('pointerup', stop);
    };
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', stop);
  }

  let heading = $state<HTMLElement | null>(null);

  // The title fills the band, and gets smaller only where the words would run past the key.
  function fit() {
    if (!heading) return;
    heading.style.fontSize = `${TALLEST_TITLE}px`;
    const room = heading.parentElement!.clientWidth;
    const wide = heading.getBoundingClientRect().width;
    if (room > 0 && wide > room) heading.style.fontSize = `${(TALLEST_TITLE * room) / wide}px`;
  }

  // Fonts arrive after the first layout, and the grip changes the room, so this is measured when they do.
  onMount(() => {
    const watch = new ResizeObserver(fit);
    watch.observe(heading!.parentElement!);
    void document.fonts.ready.then(fit);
    return () => watch.disconnect();
  });

  // At the root of the page, because a pane's blur makes it the frame that fixed positions are measured from.
  function atRoot(node: HTMLElement) {
    document.body.append(node);
    return { destroy: () => node.remove() };
  }
</script>

<svelte:window onkeydown={(event) => event.key === 'Escape' && onClose()} />

<div class="veil" use:atRoot role="presentation" onpointerdown={(event) => event.target === event.currentTarget && onClose()}>
  <div class="window" style:--width="{width}px" style:--height="{height}px" role="dialog" aria-modal="true" aria-label={title}>
    <header style:background-image="url({vinyl})">
      {#if glyph}<i class="icon mark">{glyph}</i>{/if}
      <div class="title"><h2 bind:this={heading}>{title.toLowerCase()}</h2></div>
      {#if !footer}<button class="key" title={text('Common_Cancel')} aria-label={text('Common_Cancel')} onclick={onClose}><i class="icon">{icons.close}</i></button>{/if}
    </header>
    {@render banner?.()}
    <div class="body">
      {@render children()}
    </div>
    {#if footnote}<div class="footnote">{@render footnote()}</div>{/if}
    {#if footer || leading}
      <footer>
        <div class="leading">{@render leading?.()}</div>
        <div class="keys">{@render footer?.()}</div>
      </footer>
    {/if}
    <span class="grip" role="presentation" onpointerdown={resize}></span>
  </div>
</div>

<style>
  .veil {
    position: fixed;
    inset: 0;
    z-index: 20;
    display: grid;
    place-items: center;
    padding: 24px;
    background: rgb(0 0 0 / 0.4);
  }

  .window {
    position: relative;
    display: flex;
    flex-direction: column;
    box-sizing: border-box;
    width: min(var(--width), 100%);
    height: min(var(--height), 100%);
    min-height: 0;
    overflow: hidden;
    border: 1px solid rgb(255 255 255 / 0.12);
    border-radius: 18px;
    background: rgb(255 255 255 / 0.1);
    backdrop-filter: blur(30px);
    box-shadow: 0 18px 60px rgb(0 0 0 / 0.5);
  }

  header {
    position: relative;
    display: flex;
    flex: none;
    align-items: stretch;
    height: 112px;
    padding: 17px 120px 3px 26px;
    background-position: top;
    background-size: cover;
  }

  .mark {
    position: absolute;
    top: 16px;
    left: 18px;
    width: 80px;
    color: #0e141e;
    font-size: 80px;
    line-height: 80px;
    pointer-events: none;
    text-align: center;
  }

  .title {
    position: relative;
    display: flex;
    flex: 1;
    align-items: center;
    min-width: 0;
  }

  h2 {
    width: fit-content;
    margin: 0;
    color: rgb(255 255 255 / 0.5);
    font: 400 188.7px / 92px Thiamine, Cabin, sans-serif;
    white-space: nowrap;
  }

  .key {
    position: absolute;
    top: 50%;
    right: 20px;
    transform: translateY(-50%);
  }

  .body {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 12px;
    min-height: 0;
    margin-top: 20px;
    padding: 0 24px;
    overflow-y: auto;
  }

  .footnote {
    padding: 12px 24px 0;
  }

  footer {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    align-items: center;
    justify-content: space-between;
    padding: 24px 24px 24px;
  }

  .leading {
    min-width: 0;
  }

  .keys {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    justify-content: flex-end;
    margin-left: auto;
  }

  .grip {
    position: absolute;
    right: 4px;
    bottom: 4px;
    width: 14px;
    height: 14px;
    background: radial-gradient(circle at 3px 11px, rgb(255 255 255 / 0.4) 1px, transparent 1.5px), radial-gradient(circle at 7px 11px, rgb(255 255 255 / 0.4) 1px, transparent 1.5px), radial-gradient(circle at 11px 11px, rgb(255 255 255 / 0.4) 1px, transparent 1.5px), radial-gradient(circle at 7px 7px, rgb(255 255 255 / 0.4) 1px, transparent 1.5px), radial-gradient(circle at 11px 7px, rgb(255 255 255 / 0.4) 1px, transparent 1.5px), radial-gradient(circle at 11px 3px, rgb(255 255 255 / 0.4) 1px, transparent 1.5px);
    cursor: nwse-resize;
    touch-action: none;
  }

  @media (max-width: 699px) {
    .veil {
      padding: 0;
    }

    .window {
      width: 100%;
      height: 100%;
      border: 0;
      border-radius: 0;
    }

    header {
      box-sizing: content-box;
      padding-top: max(17px, env(safe-area-inset-top));
    }

    .body {
      margin-top: 16px;
      padding: 0 16px;
    }

    footer {
      padding: 16px;
    }

    .grip {
      display: none;
    }
  }
</style>
