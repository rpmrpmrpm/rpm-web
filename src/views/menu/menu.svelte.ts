// The right-click menu: one at a time, for the whole app. A view says what its menu holds at the moment it opens,
// because a record's state changes while it is on screen.

import { tidy, type MenuEntry } from './entries';

export type { MenuEntry, MenuItem } from './entries';
export { tidy };

const LONG_PRESS_MS = 500;
const SLOP = 10;

// Held raw: a sub menu's rows are read when it opens, because the list of playlists may have arrived by then.
class Showing {
  entries = $state.raw<MenuEntry[] | null>(null);
  x = $state(0);
  y = $state(0);
}

export const menu = new Showing();

export function openMenu(entries: MenuEntry[], x: number, y: number) {
  menu.entries = entries;
  menu.x = x;
  menu.y = y;
}

export function closeMenu() {
  menu.entries = null;
}

// A right click, or a long press on a touch screen, where a browser has no right click to give.
export function menuOn(node: HTMLElement, entries: () => MenuEntry[] | Promise<MenuEntry[]>) {
  let held: ReturnType<typeof setTimeout> | undefined;
  let from = { x: 0, y: 0 };

  const show = async (x: number, y: number) => {
    const list = tidy(await entries());
    if (list.length) openMenu(list, x, y);
  };

  function context(event: MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    void show(event.clientX, event.clientY);
  }

  // The press that opened the menu has not finished, so the click it ends in must not reach the row.
  const swallow = (event: Event) => {
    event.preventDefault();
    event.stopPropagation();
  };

  function pressed(event: PointerEvent) {
    if (event.pointerType !== 'touch') return;
    from = { x: event.clientX, y: event.clientY };
    held = setTimeout(() => {
      node.addEventListener('click', swallow, { capture: true, once: true });
      setTimeout(() => node.removeEventListener('click', swallow, { capture: true }), 700);
      void show(from.x, from.y);
    }, LONG_PRESS_MS);
  }

  const released = () => clearTimeout(held);

  function moved(event: PointerEvent) {
    if (Math.hypot(event.clientX - from.x, event.clientY - from.y) > SLOP) clearTimeout(held);
  }

  node.addEventListener('contextmenu', context);
  node.addEventListener('pointerdown', pressed);
  node.addEventListener('pointerup', released);
  node.addEventListener('pointercancel', released);
  node.addEventListener('pointermove', moved);

  return {
    update(next: () => MenuEntry[] | Promise<MenuEntry[]>) {
      entries = next;
    },
    destroy() {
      clearTimeout(held);
      node.removeEventListener('contextmenu', context);
      node.removeEventListener('pointerdown', pressed);
      node.removeEventListener('pointerup', released);
      node.removeEventListener('pointercancel', released);
      node.removeEventListener('pointermove', moved);
    },
  };
}
