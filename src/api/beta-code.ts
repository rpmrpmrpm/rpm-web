// The code from a closed beta mail. The mail's link carries it. It is taken off the address straight
// away, and kept for this tab, so it survives the steps of signing up and a visit to Apple or Google.

const KEY = 'rpm-beta-code';

export function keepCodeFromAddress(): void {
  const address = new URL(location.href);
  const code = address.searchParams.get('invite');
  if (!code) return;
  sessionStorage.setItem(KEY, code);
  address.searchParams.delete('invite');
  history.replaceState(null, '', address);
}

export const keptCode = (): string => sessionStorage.getItem(KEY) ?? '';

export const forgetCode = (): void => sessionStorage.removeItem(KEY);
