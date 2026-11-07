// A full library behind a mock of rpm's API, for looking at every screen as it stands with real amounts of
// data: long titles, many albums, plays, playlists and stations.

const PALETTE = ['#7c2d12', '#1e3a8a', '#14532d', '#581c87', '#831843', '#0f766e', '#a16207', '#3f3f46'];
// Super Trouper, first on the shelf, wears a DVD box, which is taller than a record.
const TALL_SLEEVE = 26;
const sleeve = (index) => {
  const height = index === TALL_SLEEVE ? 720 : 512;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="${height}"><rect width="512" height="${height}" fill="${PALETTE[index % PALETTE.length]}"/><circle cx="256" cy="256" r="${80 + (index % 5) * 30}" fill="#fff" opacity="0.18"/></svg>`;
};

const ALBUMS = [
  ['Back to Bedlam', 'James Blunt', 'Pop', 2004],
  ['BOOOM! The Number 1 Dance Album - Best Of 2000', 'Various Artists', 'Dance', 2000],
  ['Before The Amplifiers: Live Acoustic Sessions at the Old Theatre', 'Sister Hazel', 'Rock', 2007],
  ['Evita: Music From the Motion Picture Soundtrack (Complete Edition)', 'Andrew Lloyd Webber', 'Soundtrack', 1996],
  ["It's Not Me, It's You", 'Lily Allen', 'Pop', 2009],
  ['August and Everything After', 'Counting Crows', 'Rock', 1993],
  ['Clandestino', 'Manu Chao', 'World', 1998],
  ['Dummy', 'Portishead', 'Trip Hop', 1994],
  ['Kid A', 'Radiohead', 'Rock', 2000],
  ['Halcyon', 'Ellie Goulding', 'Pop', 2012],
  ['18 Months', 'Calvin Harris', 'House', 2012],
  ['Little Earthquakes', 'Tori Amos', 'Alternative', 1992],
  ['The Very Best Of Enya', 'Enya', 'New Age', 2009],
  ['Dreamland', 'Black Box', 'Dance', 1990],
  ['Hurry Up, We\'re Dreaming', 'M83', 'Electronic', 2011],
  ['Book Of Days', 'Enya', 'New Age', 1992],
  ['Ten Summoner\'s Tales', 'Sting', 'Rock', 1993],
  ['Should I Ever Love Again', 'Timi Yuro', 'Soul', 1984],
  ['Introduction', 'Cher', 'Pop', 1965],
  ['Raining in Baltimore', 'Counting Crows', 'Rock', 1994],
  ['Dante\'s Prayer', 'Loreena McKennitt', 'Folk', 1997],
  ['Tears and Rain', 'James Blunt', 'Pop', 2004],
  ['Discovery', 'Daft Punk', 'Electronic', 2001],
  ['Cross', 'Justice', 'Electro', 2007],
  ['Melody A.M.', 'Röyksopp', 'Downtempo', 2001],
  ['Surrender', 'The Chemical Brothers', 'Electronic', 1999],
  ['Super Trouper', 'ABBA', 'Pop', 1980],
  ['Selected Ambient Works 85-92', 'Aphex Twin', 'Techno', 1992],
  ['Music Has the Right to Children', 'Boards of Canada', 'Electronic', 1998],
  ['Mezzanine', 'Massive Attack', 'Trip Hop', 1998],
];

const track = (albumIndex, number) => {
  const [album, artist, genre, year] = ALBUMS[albumIndex];
  const id = `t${albumIndex}-${number}`;
  return {
    rpmId: id,
    sha256: id,
    relativePath: `${artist}/${album}/${number} Song ${number}.flac`,
    title: number === 1 && albumIndex === 1 ? 'A very long song title that does not fit on any telephone screen at all' : `Song ${number} of ${album.slice(0, 12)}`,
    artist,
    album,
    addedAt: 2000 + albumIndex * 10 + number,
    tags: { genre, year, trackNumber: number, durationSeconds: 180 + number * 7, albumArtist: artist },
  };
};

export const FILES = ALBUMS.flatMap((_, albumIndex) => [1, 2, 3, 4, 5].map((number) => track(albumIndex, number)));

const PLAYS = FILES.map((file, index) => ({ rpmId: file.rpmId, deviceId: 'other', plays: 40 - (index % 40), lastPlayedAt: 1_800_000_000 - index * 3600, updatedAt: 1 }));

const STATIONS = Array.from({ length: 24 }, (_, index) => ({
  uuid: `s${index}`,
  name: ['Radio Paradise Main Mix FLAC', 'NPO Radio 5', 'KINK', 'NPO Funx Arab'][index % 4] + (index > 3 ? ` ${index}` : ''),
  streamUrl: `https://stream.test/${index}`,
  homepage: 'https://radio.test/',
  favicon: `https://radio.test/logo-${index}.png`,
  tags: ['rock', 'pop'],
  countryCode: 'NL',
  country: 'The Netherlands',
  codec: 'AAC',
  bitrateKbps: 192,
  votes: 100 - index,
}));

const answer = (route, status, body = {}) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

// The cover keys are the app's own hash of a record's tags, so they are worked out by the app, in a page.
export async function coverKeysOn(page) {
  const keys = await page.evaluate(async (files) => {
    const { coverSpellings } = await import('/src/library/art-key.ts');
    const groups = new Map();
    for (const file of files) groups.set(file.album, [...(groups.get(file.album) ?? []), file]);
    return Promise.all([...groups.values()].map(async (tracks) => (await coverSpellings(tracks))[0]));
  }, FILES);
  coverKeys.list = keys;
}

const coverKeys = { list: [] };

// Answers everything the app asks for, in place of the accounts service and the API.
export async function serve(page, site, files = FILES) {
  const playlists = [
    { playlistId: 'p1', name: 'Road trip', trackIds: FILES.slice(0, 8).map((file) => file.rpmId), folder: [], updatedAt: 5 },
    { playlistId: 'p2', name: 'A playlist with a name that is much too long for a phone', trackIds: FILES.slice(8, 12).map((file) => file.rpmId), folder: ['Summer'], updatedAt: 6 },
  ];
  await page.route(`${site}/accounts/**`, (route) => {
    const path = new URL(route.request().url()).pathname.replace('/accounts/', '');
    if (path === 'auth/refresh') return answer(route, 200, { accessToken: 'token', expiresIn: 3600 });
    if (path === 'auth/me') return answer(route, 200, { userId: 'screens', email: 'a@b.c', displayName: 'A', grSupporter: true, grTester: true });
    return answer(route, 404);
  });
  await page.route('https://cover.test/**', (route) => {
    const index = Number(new URL(route.request().url()).pathname.slice(1)) || 0;
    return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: sleeve(index) });
  });
  await page.route('https://radio.test/**', (route) => route.fulfill({ status: 200, contentType: 'image/svg+xml', body: sleeve(3) }));
  await page.route(`${site}/api/**`, (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace('/api/', '');
    if (path === 'cloud/list') return answer(route, 200, { files, nextCursor: null });
    if (path === 'cloud/playlists') return answer(route, 200, { playlists });
    if (path === 'cloud/moodlists') return answer(route, 404);
    if (path === 'cloud/track-plays') return answer(route, 200, { tracks: PLAYS });
    if (path === 'cloud/album-marks') return answer(route, 200, { albums: [] });
    if (path === 'cloud/art') return answer(route, 200, { albumKeys: coverKeys.list });
    if (path.startsWith('cloud/art/')) return answer(route, 200, { url: `https://cover.test/${Math.max(0, coverKeys.list.indexOf(path.split('/').pop()))}` });
    if (path.startsWith('cloud/stream/')) return answer(route, 200, { url: `${site}/proof/tracks/flac-1.flac`, kilobits: 0, live: false, expiresInSeconds: 3600 });
    if (path === 'profile') return answer(route, 200, { userId: 'screens', displayName: 'A Listener', hasAvatar: true, avatarUpdatedAt: 7, createdAt: 1 });
    if (path === 'profiles/screens/avatar') return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: sleeve(5) });
    // A track with no sidecar: the edit windows read the row alone, and write no sidecar.
    if (path.startsWith('cloud/sidecar/')) return answer(route, 404);
    if (path === 'artwork') return answer(route, 200, { cover: null, backgrounds: ['https://cover.test/1'], thumbs: [], logo: null });
    if (path === 'artwork/fetch') return answer(route, 200, { url: 'https://cover.test/2' });
    if (path === 'radio/stations' || path === 'radio/stations/filed') return answer(route, 200, { stations: STATIONS });
    if (path === 'radio/countries') return answer(route, 200, { countries: [{ name: 'The Netherlands', code: 'NL', stationCount: 200 }] });
    if (path === 'metadata/article') return answer(route, 200, { article: { title: 'About', text: 'First paragraph.\nSecond paragraph.', url: 'https://en.wikipedia.org/wiki/X', language: 'en' } });
    return answer(route, 200, {});
  });
  return { playlists };
}
