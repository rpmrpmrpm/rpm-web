import { describe, expect, it } from 'vitest';

import { Volume } from '../../src/audio/volume';

const element = () => ({ volume: 1 }) as HTMLMediaElement;

function memory(stored?: string) {
  const held = new Map<string, string>(stored === undefined ? [] : [['rpm-volume', stored]]);
  return { getItem: (key: string) => held.get(key) ?? null, setItem: (key: string, value: string) => void held.set(key, value), held };
}

describe('the volume', () => {
  it('sets every element it drives, the radio as well as the player', () => {
    const volume = new Volume(null);
    const player = element();
    const radio = element();
    volume.drive(player);
    volume.drive(radio);
    volume.set(0.3);
    expect(player.volume).toBe(0.3);
    expect(radio.volume).toBe(0.3);
  });

  it('gives an element the level it has now when it is first driven', () => {
    const volume = new Volume(null);
    volume.set(0.4);
    const radio = element();
    volume.drive(radio);
    expect(radio.volume).toBe(0.4);
  });

  it('keeps the level between visits, and opens at full for a stored zero', () => {
    const store = memory();
    new Volume(store).set(0.25);
    expect(new Volume(store).level).toBe(0.25);
    expect(new Volume(memory('0')).level).toBe(1);
    expect(new Volume(memory('nonsense')).level).toBe(1);
  });

  it('holds the level within the page when storage throws', () => {
    const volume = new Volume({
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    });
    expect(volume.level).toBe(1);
    volume.set(0.5);
    expect(volume.level).toBe(0.5);
  });

  it('mutes to zero and puts back the level it had', () => {
    const volume = new Volume(null);
    const player = element();
    volume.drive(player);
    volume.set(0.6);
    volume.toggleMute();
    expect(volume.muted).toBe(true);
    expect(player.volume).toBe(0);
    volume.toggleMute();
    expect(volume.level).toBe(0.6);
    expect(player.volume).toBe(0.6);
  });

  it('unmutes to half when the level was taken to zero with the slider', () => {
    const volume = new Volume(null);
    volume.set(0);
    volume.toggleMute();
    expect(volume.level).toBe(0.5);
  });

  it('keeps the level between nothing and full, and tells its listeners once per change', () => {
    const volume = new Volume(null);
    let told = 0;
    volume.onChange(() => told++);
    volume.set(2);
    expect(volume.level).toBe(1);
    expect(told).toBe(0);
    volume.set(-1);
    expect(volume.level).toBe(0);
    volume.set(Number.NaN);
    expect(told).toBe(1);
  });
});
