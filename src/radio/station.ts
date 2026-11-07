// A radio station, and the rules for how it is named and described. These are RadioStation, RadioNames, RadioAds and
// StationSign in the other apps. The directory is written by volunteers, so a name arrives with its bitrate in it,
// and one station arrives as a row per stream.

export interface StationEdit {
  name: string | null;
  tags: string[] | null;
  description: string | null;
}

export interface RadioStation {
  uuid: string;
  name: string;
  streamUrl: string;
  homepage?: string | null;
  favicon?: string | null;
  otherLogos?: string[];
  alsoFiledAs?: string[];
  country?: string | null;
  countryCode?: string | null;
  language?: string | null;
  tags?: string[];
  codec?: string | null;
  bitrateKbps?: number;
  votes?: number;
  clickCount?: number;
  isHls?: boolean;
  reachable?: boolean;
  // Set where a name alone would not tell two stations apart.
  shownName?: string | null;
  edit?: StationEdit | null;
}

const DASHES = [' - ', ' – ', ' — ', ' -- ', ' | '];
const UNITS = ['kbps', 'kbit', 'kbs', 'kb', 'k'];
const SLOWEST = 8;
const FASTEST = 2000;

const QUALITY_WORDS = new Set([
  'mp3', 'aac', 'aacp', 'aac+', 'he-aac', 'heaac', 'ogg', 'opus', 'vorbis', 'flac', 'wma', 'wav', 'alac', 'mp2', 'm4a', 'hls',
  'hq', 'hd', 'sq', 'lq', 'hifi', 'hi-fi', 'highquality', 'lowquality', 'lofi', 'lo-fi', 'kbps', 'kbit', 'kb', 'bitrate',
  'stereo', 'mono', 'cd', 'cdq', 'quality',
]);

const NOISE_WORDS = new Set([
  'radio', 'radios', 'fm', 'am', 'hd', 'sd', 'dab', 'live', 'stream', 'streaming', 'online', 'net', 'web', 'webradio',
  'digital', 'channel', 'station', 'the', 'and', 'mp3', 'aac', 'aacp', 'ogg', 'opus', 'vorbis', 'flac', 'wma', 'hls',
  'high', 'low', 'hq', 'sq', 'lq', 'hifi', 'kbps', 'kbit', 'kb', 'quality', 'stereo', 'official',
]);

const GEO_WORDS: Record<string, string[]> = {
  NL: ['nederland', 'nederlandse', 'netherlands', 'holland', 'dutch'],
  GB: ['uk', 'britain', 'british', 'england', 'unitedkingdom'],
  US: ['usa', 'america', 'american'],
  DE: ['deutschland', 'germany', 'german'],
  FR: ['france', 'french'],
  IT: ['italia', 'italy', 'italian', 'italiana'],
  ES: ['espana', 'spain', 'spanish'],
  BE: ['belgie', 'belgium', 'belgique'],
  AT: ['osterreich', 'austria'],
  CH: ['schweiz', 'switzerland', 'suisse', 'svizzera'],
  SE: ['sverige', 'sweden'],
  NO: ['norge', 'norway'],
  DK: ['danmark', 'denmark'],
  FI: ['suomi', 'finland'],
  PT: ['portugal', 'portuguesa'],
  PL: ['polska', 'poland'],
  IE: ['ireland', 'eire'],
  CA: ['canada'],
  AU: ['australia'],
  BR: ['brasil', 'brazil'],
  MX: ['mexico'],
  IN: ['india'],
};

const isLetterOrNumber = (character: string | undefined) => !!character && /[\p{L}\p{N}]/u.test(character);

const deaccent = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '');

const isBitrate = (word: string) => /^[0-9]+$/.test(word) && Number(word) >= SLOWEST && Number(word) <= FASTEST;

function isQuality(word: string): boolean {
  const folded = word.trim().toLowerCase().replace(/\++$/, '');
  if (!folded) return false;
  if (QUALITY_WORDS.has(folded)) return true;
  return UNITS.some((unit) => folded.endsWith(unit) && folded.length > unit.length && isBitrate(folded.slice(0, -unit.length)));
}

function allQuality(inside: string): boolean {
  let named = false;
  for (const word of inside.split(/[ /,-]+/).filter(Boolean)) {
    if (isQuality(word)) named = true;
    else if (!isBitrate(word)) return false;
  }
  return named;
}

// The end of a specification that starts here, or null: a #MP3# mark, a bracket of nothing but, or a run of words.
function marker(text: string[], at: number): number | null {
  const wordEnd = (from: number) => {
    let end = from;
    while (end < text.length && (isLetterOrNumber(text[end]) || text[end] === '+')) end++;
    return end;
  };

  if (text[at] === '#') {
    const end = wordEnd(at + 1);
    if (!isQuality(text.slice(at + 1, end).join(''))) return null;
    return text[end] === '#' ? end + 1 : end;
  }

  const close = text[at] === '(' ? ')' : text[at] === '[' ? ']' : null;
  if (close) {
    const shut = text.indexOf(close, at + 1);
    return shut >= 0 && allQuality(text.slice(at + 1, shut).join('')) ? shut + 1 : null;
  }

  if (!isLetterOrNumber(text[at]) || isLetterOrNumber(text[at - 1])) return null;
  let run = at;
  let last = -1;
  let named = false;
  while (run < text.length) {
    const word = wordEnd(run);
    if (word === run) break;
    const it = text.slice(run, word).join('');
    if (isQuality(it)) named = true;
    else if (!isBitrate(it)) break;
    last = word;
    run = word;
    while (text[run] === ' ' || text[run] === '/') run++;
  }
  return named && last > at ? last : null;
}

const tidy = (text: string) => text.replace(/\s+/g, ' ').replace(/^[ \-–|,:/()[\]]+|[ \-–|,:/()[\]]+$/g, '');

function strip(text: string, original: string | null | undefined): string {
  if (!text) return original ?? '';
  const characters = [...text];
  let cut = '';
  for (let at = 0; at < characters.length; ) {
    const end = marker(characters, at);
    if (end !== null) {
      at = end;
      continue;
    }
    cut += characters[at];
    at++;
  }
  return tidy(cut) || text;
}

function headline(name: string): string {
  let at = -1;
  for (const dash of DASHES) {
    const found = name.indexOf(dash);
    if (found > 0 && (at < 0 || found < at)) at = found;
  }
  return at < 0 ? name : name.slice(0, at).trim();
}

export const cleanName = (name: string | null | undefined): string => strip(headline(name ?? ''), name);
export const fullName = (name: string | null | undefined): string => strip(name ?? '', name);

export const displayOf = (station: RadioStation): string => station.edit?.name ?? station.shownName ?? cleanName(station.name);

export const genresOf = (tags: readonly string[] | null | undefined): string[] =>
  (tags ?? []).map((tag) => tag.trim()).filter((tag) => tag && !tag.startsWith('#') && !allQuality(tag));

export const shownTags = (station: RadioStation): string[] => station.edit?.tags ?? station.tags ?? [];

// Two stations whose short names are the same keep their long ones.
export function distinguish(stations: RadioStation[]): RadioStation[] {
  if (stations.length < 2) return stations;
  const heads = new Map<string, number>();
  for (const station of stations) {
    const head = (station.edit?.name ?? cleanName(station.name)).toLowerCase();
    heads.set(head, (heads.get(head) ?? 0) + 1);
  }
  if (![...heads.values()].some((count) => count > 1)) return stations;
  return stations.map((station) => {
    if (station.edit?.name) return station;
    const head = cleanName(station.name);
    const whole = fullName(station.name);
    return (heads.get(head.toLowerCase()) ?? 0) > 1 && head !== whole ? { ...station, shownName: whole } : station;
  });
}

function nameWords(text: string): string[] {
  return deaccent(text)
    .toLowerCase()
    .split(/[^\p{L}\p{N}+]+/u)
    .filter(Boolean);
}

// A name with what does not tell one station from another taken out.
export function foldName(name: string | null | undefined, countryCode: string | null | undefined): string {
  const parts = nameWords(fullName(name));
  if (!parts.length) return '';
  const geo = GEO_WORDS[(countryCode ?? '').trim().toUpperCase()];
  let kept = parts.filter((part, index) => !NOISE_WORDS.has(part) && !(index > 0 && geo?.includes(part)));
  if (!kept.length) kept = parts.filter((part) => !NOISE_WORDS.has(part));
  return (kept.length ? kept : parts).join('');
}

const SIGN_NOISE = new Set(['RADIO', 'RADIOS', 'RADIU', 'RADION', 'FM', 'AM', 'HD', 'DAB', 'STATION', 'STATIONS', 'ONLINE', 'LIVE', 'STREAM', 'STREAMING', 'NET', 'WEB', 'DIGITAL', 'CHANNEL', 'THE']);
const SIGN_JOINERS = new Set(['OF', 'AND', 'THE', 'A', 'AN', 'DE', 'DA', 'DI', 'DU', 'DEL', 'LA', 'LE', 'LES', 'EL', 'IL', 'DER', 'DIE', 'DAS', 'VAN', 'VON', 'EN', 'ET', 'Y']);
const MOST_LETTERS = 4;

const isDigit = (character: string | undefined) => !!character && /\p{N}/u.test(character);

function signWords(name: string | null | undefined): string[] {
  const words: string[] = [];
  let word = '';
  for (const character of deaccent((name ?? '').trim().toUpperCase())) {
    if (isLetterOrNumber(character)) {
      if (word && isDigit(word.at(-1)) !== isDigit(character)) {
        words.push(word);
        word = '';
      }
      word += character;
    } else if (word) {
      words.push(word);
      word = '';
    }
  }
  if (word) words.push(word);
  const carried = words.filter((part) => !SIGN_NOISE.has(part));
  return carried.length ? carried : words;
}

// The three or four letters printed on the dial.
export function callSign(name: string | null | undefined): string {
  const words = signWords(name);
  if (!words.length) return '';
  let carriers = words.filter((word) => !SIGN_JOINERS.has(word));
  if (!carriers.length) carriers = words;
  const lead = carriers[0]!;

  if (carriers.length <= 2 && lead.length >= 2 && lead.length <= MOST_LETTERS) {
    const number = carriers.slice(1).find((word) => isDigit(word[0]));
    const joined = number ? lead + number : lead;
    if (joined.length >= 3 && joined.length <= MOST_LETTERS) return joined;
    if (lead.length >= 3) return lead;
  }

  if (carriers.length > 2) return carriers.slice(0, MOST_LETTERS).map((word) => word[0]).join('');

  let run = '';
  for (const word of carriers) {
    run += word;
    if (run.length >= MOST_LETTERS) break;
  }
  return run.slice(0, MOST_LETTERS);
}

const ADVERTISED = ['commercial', 'public radio', 'public service', 'public broadcast', 'offentlich rechtlich', 'government', 'state radio'];
const AD_FREE = ['non commercial', 'noncommercial', 'no ads', 'no advert', 'ad free', 'advert free', 'werbefrei', 'sans pub'];

const BROADCASTER_SITES = [
  'npo.nl', 'nporadio1.nl', 'nporadio2.nl', 'npo3fm.nl', 'nporadio4.nl', 'nporadio5.nl', 'radio1.nl', 'radio2.nl', '3fm.nl',
  'radio4.nl', 'radio5.nl', 'omroep.nl', 'funx.nl', '538.nl', 'radio538.nl', 'skyradio.nl', 'radio10.nl', 'radioveronica.nl',
  'talpanetwork.com', 'qmusic.nl', 'joe.nl', 'joe.be', 'qmusic.be', '100p.nl', 'slam.nl', 'sublimefm.nl', 'arrow.nl',
  'grootnieuwsradio.nl', 'omroepgelderland.nl', 'vrt.be', 'rtbf.be', 'radio1.be', 'studiobrussel.be', 'nostalgie.be', 'ard.de',
  'wdr.de', 'ndr.de', 'swr.de', 'br.de', 'mdr.de', 'rbb-online.de', 'hr.de', 'deutschlandfunk.de', 'deutschlandradio.de',
  '1live.de', 'antenne.de', 'ffh.de', 'radio.de', 'radiofrance.fr', 'franceinter.fr', 'franceinfo.fr', 'francemusique.fr',
  'fip.fr', 'nrj.fr', 'rtl.fr', 'europe1.fr', 'rmc.fr', 'skyrock.com', 'rai.it', 'radiorai.it', 'rtl.it', 'radiodeejay.it',
  'radio105.net', 'virginradio.it', 'rtve.es', 'cadenaser.com', 'los40.com', 'cope.es', 'ondacero.es', 'bbc.co.uk', 'bbc.com',
  'global.com', 'heart.co.uk', 'capitalfm.com', 'classicfm.com', 'bauermedia.co.uk', 'absoluteradio.co.uk', 'talksport.com',
  'rte.ie', 'todayfm.com', 'sverigesradio.se', 'nrk.no', 'dr.dk', 'yle.fi', 'orf.at', 'hitradio-oe3.at', 'srf.ch', 'rsi.ch',
  'rts.ch', 'npr.org', 'wnyc.org', 'iheart.com', 'iheartmedia.com', 'audacy.com', 'cumulusmedia.com', 'cbc.ca', 'radio-canada.ca',
];

const BROADCASTER_NAMES = [
  'npo', 'npo radio', 'npo 3fm', '3fm', 'radio 538', '538', 'sky radio', 'radio 10', 'radio veronica', 'veronica', 'qmusic',
  'q music', 'joe', '100 nl', 'slam', 'sublime', 'arrow classic rock', 'funx', 'bnr', 'kink', 'vrt', 'studio brussel', 'rtbf',
  'mnm', 'ard', 'wdr', 'ndr', 'swr', 'br', 'mdr', 'hr', '1live', 'deutschlandfunk', 'antenne bayern', 'radio france',
  'france inter', 'france info', 'france musique', 'france culture', 'nrj', 'europe 1', 'rtl', 'rmc', 'skyrock', 'rai',
  'radio deejay', 'radio 105', 'virgin radio', 'rne', 'cadena ser', 'los 40', 'cope', 'onda cero', 'bbc', 'heart', 'capital',
  'classic fm', 'smooth', 'absolute radio', 'talksport', 'lbc', 'rte', 'today fm', 'sveriges radio', 'nrk', 'dr p', 'yle', 'orf',
  'hitradio o3', 'srf', 'rsi', 'rts', 'npr', 'wnyc', 'cbc', 'ici radio canada',
];

const foldPhrase = (text: string) =>
  deaccent(text)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

function isBroadcaster(name: string | null | undefined, homepage: string | null | undefined): boolean {
  try {
    const host = new URL(homepage ?? '').hostname.toLowerCase();
    if (BROADCASTER_SITES.some((site) => host === site || host.endsWith(`.${site}`))) return true;
  } catch {
    // No page to go on.
  }
  const folded = foldPhrase(name ?? '');
  return !!folded && BROADCASTER_NAMES.some((known) => folded === known || folded.startsWith(`${known} `));
}

// An ad-free tag settles it. Otherwise a tag that says so, or a broadcaster known to.
export function carriesAds(station: Pick<RadioStation, 'tags' | 'name' | 'homepage'>): boolean {
  let carries = false;
  for (const raw of station.tags ?? []) {
    const tag = foldPhrase(raw);
    if (!tag) continue;
    if (AD_FREE.some((word) => tag.includes(word))) return false;
    carries ||= ADVERTISED.some((word) => tag.includes(word));
  }
  return carries || isBroadcaster(station.name, station.homepage);
}
