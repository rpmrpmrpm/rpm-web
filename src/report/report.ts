// Reports. Feedback is sent when the user presses Send. A crash is kept in this browser, and it is
// sent later and only with the user's consent, because the page may be in no state to send it.

import type { Api } from '../api/http';

const INSTALL_KEY = 'rpm-install-id';
const CRASHES_KEY = 'rpm-crashes';
const CONSENT_KEY = 'rpm-crash-consent';
const CRASHES_KEPT = 5;
const HEAD = 'web';

// Ticks of .NET's clock, which the server stores: 100 ns since the year 1.
const TICKS_AT_UNIX_EPOCH = 621355968000000000;
const utcTicks = (date: Date) => date.getTime() * 10000 + TICKS_AT_UNIX_EPOCH;

const version = (): string => import.meta.env.VITE_RPM_VERSION ?? '0.0.0';

function hex(bytes: number): string {
  return [...crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// A random id for this browser, used only to tell installs apart.
export function installId(): string {
  try {
    const known = localStorage.getItem(INSTALL_KEY);
    if (known) return known;
    const made = hex(16);
    localStorage.setItem(INSTALL_KEY, made);
    return made;
  } catch {
    return hex(16);
  }
}

const context = () => ({
  head: HEAD,
  appVersion: version(),
  platform: navigator.userAgent,
  architecture: '',
  installId: installId(),
  scope: 'full',
});

export interface Feedback {
  kind: 'problem' | 'idea';
  area: string;
  message: string;
  replyTo?: string | null;
}

// True when the report arrived. The caller keeps the text on screen when it did not.
export async function sendFeedback(api: Api, feedback: Feedback): Promise<boolean> {
  try {
    await api.call('errors/feedback', {
      method: 'POST',
      body: { ...feedback, ...context(), recent: null, screenshotPng: null, atUtcTicks: utcTicks(new Date()) },
    });
    return true;
  } catch {
    return false;
  }
}

interface HeldCrash {
  crashId: string;
  crashedAtUtcTicks: number;
  exception: string;
}

function held(): HeldCrash[] {
  try {
    return JSON.parse(localStorage.getItem(CRASHES_KEY) ?? '[]');
  } catch {
    return [];
  }
}

function hold(crashes: HeldCrash[]) {
  try {
    localStorage.setItem(CRASHES_KEY, JSON.stringify(crashes.slice(-CRASHES_KEPT)));
  } catch {
    // Storage is full or blocked. The crash is lost, and the page carries on.
  }
}

function keepCrash(error: unknown) {
  const exception = error instanceof Error ? `${error.name}: ${error.message}\n${error.stack ?? ''}` : String(error);
  hold([...held(), { crashId: `crash_${hex(12)}`, crashedAtUtcTicks: utcTicks(new Date()), exception }]);
}

export function captureCrashes() {
  addEventListener('error', (event) => keepCrash(event.error ?? event.message));
  addEventListener('unhandledrejection', (event) => keepCrash(event.reason));
}

export function crashConsent(): boolean {
  try {
    return localStorage.getItem(CONSENT_KEY) === 'yes';
  } catch {
    return false;
  }
}

export function setCrashConsent(agreed: boolean) {
  try {
    localStorage.setItem(CONSENT_KEY, agreed ? 'yes' : 'no');
  } catch {
    // Without storage the question is asked again next time.
  }
}

// Sends what is held. A crash leaves the list only when the server has it, and needs a signed-in
// user, because the web app has no key for the signed-out route.
export async function sendHeldCrashes(api: Api): Promise<void> {
  if (!crashConsent()) return;
  for (const crash of held()) {
    try {
      await api.call('errors/crash', {
        method: 'POST',
        body: { ...crash, ...context(), systemReport: null, systemReportKind: null, recent: null },
      });
      hold(held().filter((other) => other.crashId !== crash.crashId));
    } catch {
      return;
    }
  }
}
