<script lang="ts">
  // The menu itself, with the desktop's measures: rows 29.5 high, 12 pt words, a 16 box for the mark. It stands where
  // it was asked for, and moves in from an edge it would cross. On a phone it comes up from the foot of the screen.
  import { closeMenu, menu, type MenuEntry, type MenuItem } from './menu.svelte';
  import { icons } from '../../design/icons';

  const MARGIN = 8;
  const NARROW = 700;

  let panel = $state<HTMLElement | null>(null);
  let left = $state(0);
  let top = $state(0);
  let trail = $state.raw<{ items: MenuEntry[]; left: number; top: number }[]>([]);

  const narrow = $derived(innerWidth < NARROW);

  // The sub menu stands beside its row, on whichever side has room.
  function place(node: HTMLElement, at: { x: number; y: number; beside?: number }) {
    const { width, height } = node.getBoundingClientRect();
    let x = at.x;
    if (x + width > innerWidth - MARGIN) x = at.beside !== undefined ? at.beside - width : innerWidth - width - MARGIN;
    const y = Math.min(at.y, innerHeight - height - MARGIN);
    return { x: Math.max(MARGIN, x), y: Math.max(MARGIN, y) };
  }

  $effect(() => {
    if (!menu.entries || !panel || narrow) return;
    const { x, y } = place(panel, { x: menu.x, y: menu.y });
    left = x;
    top = y;
    panel.querySelector('button')?.focus({ preventScroll: true });
  });

  $effect(() => {
    void menu.entries;
    trail = [];
  });

  function choose(item: MenuItem) {
    if (item.disabled) return;
    if (item.items) return;
    closeMenu();
    item.run?.();
  }

  function openSub(event: Event, item: MenuItem, depth: number) {
    trail = trail.slice(0, depth);
    if (!item.items || item.disabled) return;
    const row = (event.currentTarget as HTMLElement).getBoundingClientRect();
    trail = [...trail, { items: item.items, left: row.right, top: row.top - 4 }];
  }

  function sub(node: HTMLElement, level: { left: number; top: number; beside: number }) {
    const { x, y } = place(node, { x: level.left, y: level.top, beside: level.beside });
    node.style.left = `${x}px`;
    node.style.top = `${y}px`;
  }

  function moveFocus(from: HTMLElement, by: number) {
    const list = [...from.closest('[role=menu]')!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
    list[(list.indexOf(from as HTMLButtonElement) + by + list.length) % list.length]?.focus();
  }

  function key(event: KeyboardEvent, item: MenuItem, depth: number) {
    if (event.key === 'ArrowDown') moveFocus(event.currentTarget as HTMLElement, 1);
    else if (event.key === 'ArrowUp') moveFocus(event.currentTarget as HTMLElement, -1);
    else if (event.key === 'ArrowRight' && item.items) openSub(event, item, depth);
    else if (event.key === 'ArrowLeft' && depth > 0) trail = trail.slice(0, depth - 1);
    else return;
    event.preventDefault();
  }

  function clicked(event: MouseEvent, item: MenuItem, depth: number) {
    if (item.items) openSub(event, item, depth);
    else choose(item);
  }
</script>

<svelte:window onkeydown={(event) => event.key === 'Escape' && closeMenu()} onresize={closeMenu} />

{#snippet rows(entries: MenuEntry[], depth: number)}
  {#each entries as entry}
    {#if entry === 'rule'}
      <hr />
    {:else}
      <button role="menuitem" disabled={entry.disabled} aria-haspopup={entry.items ? 'menu' : undefined} onpointerenter={(event) => openSub(event, entry, depth)} onclick={(event) => clicked(event, entry, depth)} onkeydown={(event) => key(event, entry, depth)}>
        <span class="mark"><i class="icon" class:outline={entry.outline}>{entry.glyph ?? ''}</i></span>
        <span class="label">{entry.label}</span>
        {#if entry.items}<i class="icon chevron">{icons.forward}</i>{:else if entry.ticked}<i class="icon chevron">{icons.check}</i>{/if}
      </button>
    {/if}
  {/each}
{/snippet}

{#if menu.entries}
  <div class="veil" role="presentation" oncontextmenu={(event) => event.preventDefault()} onpointerdown={closeMenu}></div>
  <div class="menu" class:sheet={narrow} bind:this={panel} role="menu" tabindex="-1" style:left="{left}px" style:top="{top}px">
    {@render rows(menu.entries, 0)}
  </div>
  {#each trail as level, depth (level)}
    <div class="menu" class:sheet={narrow} use:sub={{ left: level.left, top: level.top, beside: level.left - 180 }} role="menu" tabindex="-1">
      {@render rows(level.items, depth + 1)}
    </div>
  {/each}
{/if}

<style>
  .veil {
    position: fixed;
    inset: 0;
    z-index: 40;
  }

  .menu {
    position: fixed;
    z-index: 41;
    display: flex;
    flex-direction: column;
    box-sizing: border-box;
    min-width: 175px;
    max-width: 320px;
    max-height: calc(100dvh - 16px);
    padding: 3px 1px;
    overflow-y: auto;
    border: 1px solid rgb(255 255 255 / 0.094);
    border-radius: 8px;
    background: rgb(38 47 64 / 0.96);
    box-shadow: 0 8px 30px rgb(0 0 0 / 0.5);
    backdrop-filter: blur(30px);
  }

  button {
    display: flex;
    flex: none;
    gap: 12px;
    align-items: center;
    width: calc(100% - 8px);
    min-height: 25.5px;
    margin: 2px 4px;
    padding: 0 11px;
    border: 0;
    border-radius: 4px;
    background: none;
    color: #fff;
    font: inherit;
    font-size: 12px;
    text-align: left;
    white-space: nowrap;
    cursor: pointer;
  }

  button:disabled {
    color: rgb(255 255 255 / 0.36);
    cursor: default;
  }

  button:not(:disabled):hover,
  button:not(:disabled):focus-visible {
    background: rgb(255 255 255 / 0.09);
    outline: none;
  }

  .mark {
    display: grid;
    flex: none;
    place-items: center;
    width: 16px;
    height: 16px;
    font-size: 12px;
  }

  .label {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .chevron {
    flex: none;
    margin-left: 12px;
    color: rgb(255 255 255 / 0.7);
    font-size: 9px;
  }

  hr {
    flex: none;
    width: 100%;
    height: 1px;
    margin: 1px 0;
    border: 0;
    background: rgb(255 255 255 / 0.12);
  }

  /* A phone has no pointer to stand a menu beside: it comes up from the foot, with rows a thumb can hit. */
  .menu.sheet {
    top: auto !important;
    right: 0;
    bottom: 0;
    left: 0 !important;
    width: 100%;
    max-width: none;
    max-height: 70dvh;
    padding: 8px 4px max(8px, env(safe-area-inset-bottom));
    border-width: 1px 0 0;
    border-radius: 16px 16px 0 0;
  }

  .menu.sheet button {
    min-height: 44px;
    font-size: 15px;
  }

  .menu.sheet .mark {
    font-size: 15px;
  }
</style>
