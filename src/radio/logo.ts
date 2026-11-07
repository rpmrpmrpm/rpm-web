// Which logo a station wears when it has several, and how to ask for one at a size. RadioLogo in the other apps.

const OWN_SITE = 4;
const ANY_SIZE = 3;
const CAN_BE_THE_MARK = 2;
const IS_A_DRAWING = 1;
const IS_A_SITE_ICON = -1;
const OVER_HTTPS = 1;

const parse = (address: string | null | undefined): URL | null => {
  try {
    return address ? new URL(address) : null;
  } catch {
    return null;
  }
};

export function isDrawable(favicon: string | null | undefined): boolean {
  const address = parse(favicon?.trim());
  return !!address && (address.protocol === 'http:' || address.protocol === 'https:') && !!address.hostname;
}

const site = (address: URL) => address.hostname.toLowerCase().replace(/^www\./, '');

export function cutsToOrder(favicon: string | null | undefined): boolean {
  const host = parse(favicon)?.hostname.toLowerCase();
  return host === 'i.iheart.com' || host === 'static.wixstatic.com' || host === 'cdn-profiles.tunein.com';
}

export function rankLogo(favicon: string | null | undefined, homepage: string | null | undefined): number {
  const address = parse(favicon);
  if (!address?.hostname) return Number.MIN_SAFE_INTEGER;

  let score = 0;
  const home = parse(homepage);
  if (home && site(home) === site(address)) score += OWN_SITE;

  const path = address.pathname.toLowerCase();
  if (path.endsWith('.png') || path.endsWith('.webp')) score += CAN_BE_THE_MARK;
  else if (path.endsWith('.svg')) score += IS_A_DRAWING;
  else if (path.endsWith('.ico')) score += IS_A_SITE_ICON;

  if (cutsToOrder(favicon)) score += ANY_SIZE;
  if (address.protocol === 'https:') score += OVER_HTTPS;
  return score;
}

const IHEART_BOX = /contain\((\d{1,5}),(\d{1,5})\)/i;
const WIX_BOX = /(fill|fit)\/w_(\d{1,5}),h_(\d{1,5})/i;
const TUNEIN_LOGO = /\/images\/logo([a-z])\.(?:png|jpe?g|webp)/i;

// The same picture at another size is the same picture.
export function samePicture(favicon: string | null | undefined): string {
  if (!favicon) return '';
  if (!cutsToOrder(favicon)) return favicon;
  return favicon.replace(IHEART_BOX, 'contain()').replace(WIX_BOX, '$1/w_,h_').replace(TUNEIN_LOGO, '/images/logo.');
}

// The logos worth trying, in order: a browser cannot fetch a picture over http from an https page.
export const logosOf = (favicon: string | null | undefined, others: readonly string[] | undefined): string[] =>
  [favicon, ...(others ?? [])].filter((logo): logo is string => !!logo && logo.startsWith('https://'));
