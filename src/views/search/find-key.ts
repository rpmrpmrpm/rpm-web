// The key that opens the search over the window: Cmd+F on Apple's computers, phones and tablets, Ctrl+F
// elsewhere. These are the keys a browser opens its own find with, and the desktop app takes the same ones
// (Shortcuts on the desktop). Only that one modifier may be held: Cmd+Shift+F and Ctrl+Alt+F stay the browser's.

export interface KeyLike {
  key: string;
  code: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

// Whether the computer's shortcuts are made with Cmd. An iPad says it is a Mac, which is right here: its keyboard
// has Cmd too.
export const usesCommand = (userAgent: string): boolean => /Macintosh|Mac OS X|iPhone|iPad|iPod/.test(userAgent);

export function isFindKey(event: KeyLike, command: boolean): boolean {
  if (event.altKey || event.shiftKey) return false;
  if (command ? !event.metaKey || event.ctrlKey : !event.ctrlKey || event.metaKey) return false;
  // The letter as typed. On a layout with no Latin letters (Cyrillic, Greek) the key does not say F, so the key in
  // F's place counts.
  return event.key.toLowerCase() === 'f' || (!/^[a-z]$/i.test(event.key) && event.code === 'KeyF');
}
