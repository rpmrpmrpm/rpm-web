import { describe, expect, it } from 'vitest';

import { planMove, planRemoval, restored, Retries, shuffled, StartGate, Transport } from '../../src/audio/queue';

describe('the transport', () => {
  it('remembers a pause pressed before the audio arrived', () => {
    const transport = new Transport();
    transport.starting();
    expect(transport.pause(true, 'nothing')).toBe('remember');
    expect(transport.wantsToPlay(true, 'nothing')).toBe(false);
    expect(transport.arrives()).toBe(true);
    expect(transport.arrives()).toBe(false);
  });

  it('withdraws the pause when play is pressed before the audio arrives', () => {
    const transport = new Transport();
    transport.pause(true, 'nothing');
    expect(transport.play(true, 'nothing')).toBe('forget');
    expect(transport.arrives()).toBe(false);
  });

  it('does not keep a pause while idle, or it would silence whatever is chosen next', () => {
    const transport = new Transport();
    expect(transport.pause(false, 'nothing')).toBe('nothing');
    expect(transport.pausePending).toBe(false);
  });

  it('does not carry a pause over to the next track chosen', () => {
    const transport = new Transport();
    transport.pause(true, 'nothing');
    transport.starting();
    expect(transport.arrives()).toBe(false);
  });

  it('shows the intent while loading and the state otherwise', () => {
    const transport = new Transport();
    expect(transport.wantsToPlay(true, 'nothing')).toBe(true);
    expect(transport.wantsToPlay(false, 'nothing')).toBe(false);
    expect(transport.wantsToPlay(false, 'playing')).toBe(true);
    expect(transport.wantsToPlay(false, 'paused')).toBe(false);
  });

  it('toggles to the opposite of what was asked for last', () => {
    const transport = new Transport();
    expect(transport.toggle(false, 'playing')).toBe('pause');
    expect(transport.toggle(false, 'paused')).toBe('resume');
    expect(transport.toggle(true, 'nothing')).toBe('remember');
    expect(transport.toggle(true, 'nothing')).toBe('forget');
  });
});

describe('the start gate', () => {
  it('lets only the last claim own the player and cancels the one before', () => {
    const gate = new StartGate();
    const first = gate.begin();
    const second = gate.begin();
    expect(first.isLive).toBe(false);
    expect(first.signal.aborted).toBe(true);
    expect(second.isLive).toBe(true);
    expect(second.signal.aborted).toBe(false);
  });

  it('retires a claim without making a new one', () => {
    const gate = new StartGate();
    const attempt = gate.begin();
    gate.retire();
    expect(attempt.isLive).toBe(false);
    expect(attempt.signal.aborted).toBe(true);
  });
});

describe('retries', () => {
  it('gives each track three goes', () => {
    const retries = new Retries();
    expect([1, 2, 3, 4].map(() => retries.mayRetry('a'))).toEqual([true, true, true, false]);
  });

  it('counts per track', () => {
    const retries = new Retries();
    retries.mayRetry('a');
    retries.mayRetry('a');
    retries.mayRetry('a');
    expect(retries.mayRetry('b')).toBe(true);
  });

  it('starts again after a track recovered', () => {
    const retries = new Retries();
    [1, 2, 3].forEach(() => retries.mayRetry('a'));
    retries.forget();
    expect(retries.mayRetry('a')).toBe(true);
  });
});

describe('editing the queue', () => {
  it('moves the playing position down once per removal above it', () => {
    expect(planRemoval(10, 5, [1, 2, 8])).toEqual({ removals: [8, 2, 1], currentIndex: 3, removedCurrent: false });
  });

  it('stops rather than slides when the playing track is removed', () => {
    expect(planRemoval(5, 2, [2])).toMatchObject({ currentIndex: -1, removedCurrent: true });
  });

  it('drops out-of-range and duplicate positions', () => {
    expect(planRemoval(3, 0, [1, 1, 9, -1]).removals).toEqual([1]);
  });

  it('follows the playing track through a move', () => {
    expect(planMove(5, 2, 2, 4).currentIndex).toBe(4);
    expect(planMove(5, 2, 0, 4).currentIndex).toBe(1);
    expect(planMove(5, 2, 4, 0).currentIndex).toBe(3);
    expect(planMove(5, 2, 3, 4).currentIndex).toBe(2);
  });

  it('clamps a move to the queue', () => {
    expect(planMove(3, 0, 9, -2)).toMatchObject({ from: 2, to: 0 });
  });
});

describe('shuffle', () => {
  const rows = ['a', 'b', 'c', 'd', 'e'].map((name) => ({ name }));

  it('moves only what is still to come', () => {
    const order = shuffled(rows, 1);
    expect(order.slice(0, 2)).toEqual(rows.slice(0, 2));
    expect(new Set(order)).toEqual(new Set(rows));
  });

  it('never gives back the same order', () => {
    // A random source that leaves the rows where they are.
    const order = shuffled(rows, 1, () => 0.999);
    expect(order.slice(2)).not.toEqual(rows.slice(2));
  });

  it('leaves one row to come alone', () => {
    expect(shuffled(rows, 3)).toEqual(rows);
  });

  it('puts the order back, keeping what was played', () => {
    const order = shuffled(rows, 0);
    const back = restored(order, 2, rows);
    expect(back.slice(0, 3)).toEqual(order.slice(0, 3));
    expect(back.slice(3).map((r) => r.name)).toEqual(
      rows.filter((r) => back.slice(3).includes(r)).map((r) => r.name));
  });

  it('keeps a row added during the shuffle in its place', () => {
    const added = { name: 'new' };
    const order = [rows[0]!, added, rows[3]!, rows[2]!];
    const back = restored(order, 0, rows);
    expect(back[1]).toBe(added);
    expect(back[2]).toBe(rows[2]);
  });

  it('treats the same record twice as two rows', () => {
    const one = { name: 'same' };
    const two = { name: 'same' };
    expect(shuffled([one, two], -1, () => 0.999)).toEqual([two, one].map((r) => r));
  });
});
