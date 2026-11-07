// What a menu holds. Views say this, and ContextMenu draws it.

export interface MenuItem {
  label: string;
  glyph?: string;
  // The one glyph with two faces: an unmarked heart is drawn as an outline.
  outline?: boolean;
  disabled?: boolean;
  // The one in force, when the rows are a choice.
  ticked?: boolean;
  run?: () => void;
  items?: MenuEntry[];
}

export type MenuEntry = MenuItem | 'rule';

// Rules only ever stand between two groups: a group that an account or a browser leaves empty takes its rule with it.
export function tidy(entries: readonly MenuEntry[]): MenuEntry[] {
  const kept = entries.filter((entry, index) => entry !== 'rule' || (index > 0 && entries[index - 1] !== 'rule'));
  while (kept[0] === 'rule') kept.shift();
  while (kept.at(-1) === 'rule') kept.pop();
  return kept;
}
