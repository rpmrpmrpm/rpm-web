#!/usr/bin/env python3
"""Brings the genre lettering and photographs in from the desktop app, so the two cannot drift apart.

    python3 scripts/gen-genre-art.py

Writes src/library/genre-wordmarks.json from GenreWordmarks.Data.cs, and copies the photographs to
public/genres. The desktop generates both from its own tables: change them there and run this again.
"""

import json
import re
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DESKTOP = ROOT.parent / 'rpm-desktop' / 'RPM.Desktop'
GENRES = DESKTOP / 'Presentation' / 'Main' / 'Genres'

ENTRY = re.compile(
    r'new\("(?P<genre>[^"]+)", "[^"]+", 0x(?P<colour>[0-9A-F]{8}), GenreFinish\.(?P<finish>\w+),\s*'
    r'(?P<aspect>[\d.]+), (?P<base>[\d.]+),\s*"(?P<left>[^"]+)",',
    re.S,
)
PHOTO = re.compile(r'new\("(?P<genre>[^"]+)", "(?P<file>[^"]+)",')


def main() -> None:
    photos = {m['genre']: m['file'] for m in PHOTO.finditer((GENRES / 'GenrePhotos.Data.cs').read_text('utf-8'))}

    marks = {}
    for m in ENTRY.finditer((GENRES / 'GenreWordmarks.Data.cs').read_text('utf-8')):
        marks[m['genre']] = {
            'colour': '#' + m['colour'][2:].lower(),
            'finish': m['finish'].lower(),
            'aspect': float(m['aspect']),
            'path': re.sub(r'^F1\s+', '', m['left']),
            'photo': photos.get(m['genre']),
        }

    (ROOT / 'src' / 'library' / 'genre-wordmarks.json').write_text(json.dumps(marks, ensure_ascii=False) + '\n', 'utf-8')

    target = ROOT / 'public' / 'genres'
    target.mkdir(parents=True, exist_ok=True)
    for name in photos.values():
        shutil.copyfile(DESKTOP / 'Assets' / 'GenrePhotos' / name, target / name)

    print(f'{len(marks)} wordmarks, {len(photos)} photographs')


if __name__ == '__main__':
    main()
