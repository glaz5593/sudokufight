import { type FindLevelOver, levelIdOf, type LevelRecords, levelOutcome } from '@sudoku-fight/engine';

import { size } from '../../../theme';
import {
  currentLevel,
  everyChapter,
  gateBefore,
  indexOfChapter,
  itemLayoutOf,
  MAP,
  mapLayout,
  nextAfterAttempt,
  nodeInfo,
  openOffset,
  plateState,
  totalStars,
  unlockedNode,
  withAttempt,
  zigzagX,
} from '../mapModel';

/**
 * The level map's geometry and states (components.md §19.2–§19.3; the Main and Map-Gate boards): every number of
 * the boards is a constant of mapModel, and the list's item heights add up the way getItemLayout says.
 */

/** Played stages 1…n, each with these stars. */
function played(
  n: number,
  stars: 0 | 1 | 2 | 3 = 2,
  from = 1,
): Record<string, { stars: 0 | 1 | 2 | 3; plays: number }> {
  const out: Record<string, { stars: 0 | 1 | 2 | 3; plays: number }> = {};
  for (let k = from; k <= n; k++) out[levelIdOf(k)] = { stars, plays: 1 };
  return out;
}

describe('the zigzag (the Main board)', () => {
  it('runs from the start edge at 64, 146, 228, 310, 228, 146 on the boards’ 390 dp phone', () => {
    expect(Array.from({ length: 7 }, (_, i) => zigzagX(i + 1, 390))).toEqual([
      64, 146, 228, 310, 228, 146, 64,
    ]);
  });

  it('is scaled down on a narrower phone and centred on a wider one', () => {
    expect(zigzagX(4, 360)).toBeCloseTo((310 * 360) / 390, 5);
    expect(zigzagX(1, 590)).toBe(100 + 64);
  });

  it('puts every node centre on it, 56 apart (64 to the boss), boss tiles 68', () => {
    const layout = mapLayout(390, 'down');
    const chapter = layout.chapters[0]!;
    expect(chapter.nodes.map((p) => p.cx)).toEqual([64, 146, 228, 310, 228, 146, 64, 146, 228, 310]);
    const gaps = chapter.nodes.slice(1).map((p, i) => p.cy - chapter.nodes[i]!.cy);
    expect(gaps).toEqual([56, 56, 56, 56, 56, 56, 56, 56, 64]);
    expect(chapter.nodes.map((p) => p.size)).toEqual([...Array(9).fill(56), 68]);
    expect([size.levelNode, size.levelNodeBoss]).toEqual([56, 68]);
    expect(chapter.nodes[9]).toMatchObject({ n: 10, boss: true });
  });
});

describe('a chapter’s item (header 44, gate 52 / 44)', () => {
  it('stacks: 16 above, the header, no gate in chapter 1 (4), the first node half a tile under', () => {
    const c1 = mapLayout(390, 'down').chapters[0]!;
    expect(c1.headerY).toBe(MAP.top);
    expect(c1.gate).toBeNull();
    expect(c1.nodes[0]!.cy).toBe(16 + 44 + 4 + 28);
    // Under the boss: its half (34), the stars (16) and 12 (with the next item's 16 above its header, the
    // board's 28).
    expect(c1.height).toBe(c1.nodes[9]!.cy + 34 + 16 + 12);
    expect(c1.height).toBe(666);
  });

  it('a closed gate takes 52 and 16; an open one 44 and 16', () => {
    const closed = mapLayout(390, 'down').chapters[1]!;
    expect(closed.gate).toMatchObject({ y: 16 + 44, height: 52, width: 220, kind: 'closed' });
    expect(closed.nodes[0]!.cy).toBe(16 + 44 + 52 + 16 + 28);
    expect(closed.height).toBe(730);
    const open = mapLayout(390, 'down', { plateOf: () => 'open' }).chapters[1]!;
    expect(open.gate).toMatchObject({ height: 44, kind: 'open' });
    expect(open.height).toBe(722);
  });

  it('getItemLayout: each offset is the sum of the heights before it, and the total their sum', () => {
    const layout = mapLayout(360, 'down', { plateOf: (c) => (c <= 3 ? 'open' : 'closed') });
    const at = itemLayoutOf(layout);
    let sum = 0;
    layout.chapters.forEach((c, i) => {
      expect(at(null, i)).toEqual({ length: c.height, offset: sum, index: i });
      sum += c.height;
    });
    expect(layout.height).toBe(sum);
    expect(layout.chapters).toHaveLength(30);
  });

  it('the path: each link cut at the items’ edges, solid up to what is open', () => {
    const layout = mapLayout(390, 'down', {
      isOpen: (n) => n <= 12,
      plateOf: (c) => (c === 2 ? 'open' : 'closed'),
    });
    const [c1, c2] = layout.chapters;
    // Chapter 1: nine links between its ten nodes, and the start of the one to chapter 2's gate.
    expect(c1!.links).toHaveLength(10);
    expect(c1!.links.at(-1)).toMatchObject({ y2: c1!.height, reached: true });
    // Chapter 2 goes on from its top edge to the gate, then to its nodes: solid to 12, faint after.
    expect(c2!.links[0]).toMatchObject({ y1: 0, reached: true });
    // The part from 10's boss to the plate (open), the plate to 11, 11 to 12; then 12 to 13 and on.
    expect(c2!.links.map((s) => s.reached)).toEqual([true, true, true, ...Array(9).fill(false)]);
    // The two halves meet at the same x.
    expect(c2!.links[0]!.x1).toBeCloseTo(c1!.links.at(-1)!.x2, 5);
  });
});

describe('where the map opens', () => {
  it('at the current node, 40 % down a viewport', () => {
    const layout = mapLayout(390, 'down');
    const c2 = layout.chapters[1]!;
    const node = c2.nodes.find((p) => p.n === 14)!;
    const offset = openOffset(layout, 14, 600);
    expect(offset).toBe(c2.offset + node.cy - 0.4 * 600);
    // The node then sits at 40 % of the viewport.
    expect(c2.offset + node.cy - offset).toBeCloseTo(240, 5);
  });

  it('never before the top, never past the end', () => {
    const layout = mapLayout(390, 'down');
    expect(openOffset(layout, 1, 800)).toBe(0);
    expect(openOffset(layout, 300, 800)).toBe(layout.height - 800);
  });

  it("mapDirection 'up' turns the order around: chapter 30 first, stage 1 at the bottom of its item", () => {
    const up = mapLayout(390, 'up');
    expect(up.chapters.map((c) => c.chapter).slice(0, 3)).toEqual([30, 29, 28]);
    expect(indexOfChapter(up, 1)).toBe(29);
    const c1 = up.chapters[29]!;
    expect(c1.nodes[0]!.cy).toBeGreaterThan(c1.nodes[9]!.cy);
    expect(c1.headerY).toBeGreaterThan(c1.nodes[0]!.cy);
    expect(up.height).toBe(mapLayout(390, 'down').height);
    // The current node still at 40 %.
    const c15 = up.chapters[indexOfChapter(up, 15)]!;
    const offset = openOffset(up, 145, 600);
    expect(c15.offset + c15.nodes[4]!.cy - offset).toBeCloseTo(240, 5);
  });
});

describe('the states, from the engine’s progress rules', () => {
  it('the current stage: the first open one never played', () => {
    expect(currentLevel({})).toBe(1);
    expect(currentLevel(played(13))).toBe(14);
    // Chapter 1 done with 10 stars (< 20): the gate stays shut, so the last open stage is current.
    expect(currentLevel(played(10, 1))).toBe(10);
    // Opened once (a restored phone): the next chapter's first stage.
    expect(currentLevel(played(10, 1), [2])).toBe(11);
  });

  it('a node is played, current, open or locked; the stars are its best', () => {
    const records: LevelRecords = played(13, 2);
    expect(nodeInfo(7, records, [], 14)).toMatchObject({ state: 'played', stars: 2 });
    expect(nodeInfo(14, records, [], 14)).toMatchObject({ state: 'current', stars: 0 });
    expect(nodeInfo(15, records, [], 14)).toMatchObject({ state: 'locked' });
    expect(nodeInfo(20, records, [], 14)).toMatchObject({ state: 'locked', boss: true });
  });

  it('a gate plate: closed, enough stars with the boss not played, or open', () => {
    const closed = gateBefore(2, played(10, 1));
    expect(plateState(closed)).toBe('closed');
    expect(closed).toMatchObject({ stars: 10, need: 20, bossPlayed: true });
    // 22 stars in chapter 4, its boss not played.
    const bossless = { ...played(39, 3) };
    expect(plateState(gateBefore(5, bossless))).toBe('bossMissing');
    expect(plateState(gateBefore(2, played(10, 2)))).toBe('open');
  });

  it('"★ 84/900"', () => {
    expect(totalStars(played(42, 2))).toEqual({ stars: 84, max: 900 });
  });
});

describe('after an attempt (the result’s "לשלב הבא")', () => {
  const find = { kind: 'find', stars: { by: 'timeMs', three: 5000, two: 10000, one: 20000 } } as const;
  const found: FindLevelOver = {
    reason: 'targetReached',
    elapsedMs: 4000,
    penaltyMs: 0,
    spots: 1,
    found: 0,
    stars: 3,
  };

  it('a played stage opens the next one', () => {
    const outcome = levelOutcome(find, found);
    expect(nextAfterAttempt('L013', played(12), [], outcome)).toBe('L014');
    expect(withAttempt(played(12), 'L013', outcome).L013).toMatchObject({ stars: 3, plays: 1 });
  });

  it('a quit counts as played too (LEVEL_RULES.quitCountsAsPlayed), with 0 stars', () => {
    const quit = levelOutcome(find, { ...found, reason: 'quit' });
    expect(nextAfterAttempt('L013', played(12), [], quit)).toBe('L014');
  });

  it('at a closed gate, and after the last stage, there is no next', () => {
    const boss = levelOutcome(find, { ...found, elapsedMs: 15000 });
    expect(nextAfterAttempt('L010', played(9, 1), [], boss)).toBeNull();
    // 9 × ★★★ and this ★: 28 stars, and the boss played.
    expect(nextAfterAttempt('L010', played(9, 3), [], boss)).toBe('L011');
    expect(nextAfterAttempt('L300', played(299, 3), [], boss)).toBeNull();
  });

  it('"פתח את כל השלבים (בדיקה)": every chapter as opened, so "לשלב הבא" goes on past a closed gate', () => {
    const boss = levelOutcome(find, { ...found, elapsedMs: 15000 });
    expect(everyChapter()).toEqual(Array.from({ length: 29 }, (_, i) => i + 2));
    expect(nextAfterAttempt('L010', played(9, 1), everyChapter(), boss)).toBe('L011');
    expect(nextAfterAttempt('L300', played(299, 3), everyChapter(), boss)).toBeNull();
    // Every node open on the map; the played and the current ones stay as they are.
    const locked = nodeInfo(12, played(7), [], 8);
    expect(locked.state).toBe('locked');
    expect(unlockedNode(locked)).toEqual({ ...locked, state: 'open' });
    const current = nodeInfo(8, played(7), [], 8);
    expect(unlockedNode(current)).toBe(current);
  });

  it('never lowers the best', () => {
    const slow = levelOutcome(find, { ...found, elapsedMs: 15000 });
    expect(withAttempt({ L005: { stars: 3, plays: 2 } }, 'L005', slow).L005).toMatchObject({
      stars: 3,
      plays: 3,
    });
  });
});
