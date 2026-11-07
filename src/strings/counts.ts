// Counts that read properly at one.

import { text } from './loc';

export const albumCount = (count: number): string => (count === 1 ? text('Genres_SubgenreAlbumOne') : text('Genres_SubgenreAlbums', count));
export const trackCount = (count: number): string => (count === 1 ? text('Rpm_Profile_TracksOne') : text('Rpm_Profile_StorageTracks', count));
