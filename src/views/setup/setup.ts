// When the setup is shown, and which step it is on. The setup is the desktop's first-run wizard, less the steps
// a browser has no use for: the account is open already, and there is no music folder on this computer.

export const SETUP_STEPS = ['region', 'import', 'look', 'layout', 'done'] as const;
export type SetupStep = (typeof SETUP_STEPS)[number];

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

// This browser's storage, and this tab's. Either is null where the browser blocks site data, and reading the
// property itself throws there.
export function browserStores(): { store: Store | null; tab: Store | null } {
  const reach = (get: () => Storage): Store | null => {
    try {
      return get();
    } catch {
      return null;
    }
  };
  return { store: reach(() => localStorage), tab: reach(() => sessionStorage) };
}

const DONE_KEY = 'rpm-setup-done';
const STEP_KEY = 'rpm-setup-step';

const doneKey = (userId: string) => `${DONE_KEY}:${userId}`;

function read(store: Store | null, key: string): string | null {
  try {
    return store?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function write(store: Store | null, key: string, value: string | null) {
  try {
    if (value === null) store?.removeItem(key);
    else store?.setItem(key, value);
  } catch {
    // Without storage the setup shows again on the next visit, which costs a press on Skip.
  }
}

// Where the setup opens, or null when it is not shown. It is shown once per account in this browser, and only
// while the library is empty: the setup is about getting music in, and a listener whose music is in the cloud
// already has done that somewhere else. A step kept for this tab comes first, because the page reloads when the
// language changes, and the setup then goes on in the new language from the step it was on.
export function openingStep(store: Store | null, tab: Store | null, userId: string, empty: boolean): SetupStep | 'hello' | null {
  if (read(store, doneKey(userId)) !== null) return null;
  const kept = read(tab, STEP_KEY);
  if (kept && (SETUP_STEPS as readonly string[]).includes(kept)) return kept as SetupStep;
  return empty ? 'hello' : null;
}

// The step the setup is on, kept for this tab until the setup ends.
export function keepStep(tab: Store | null, step: SetupStep) {
  write(tab, STEP_KEY, step);
}

// Finished or skipped: it is not shown to this account in this browser again.
export function endSetup(store: Store | null, tab: Store | null, userId: string) {
  write(store, doneKey(userId), String(Date.now()));
  write(tab, STEP_KEY, null);
}

// The kicker above each step's heading: "Step 2 of 5". The welcome before the steps has none.
export const stepNumber = (step: SetupStep): number => SETUP_STEPS.indexOf(step) + 1;
