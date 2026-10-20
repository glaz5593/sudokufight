import * as engine from '../index';
import * as config from './levels.config';

/* What the engine's index gives the server and the admin site of the levels (1.0.3; levels-content.md §5.4). */

describe('the catalog', () => {
  it('kindOfLevel, levelRev and BOSS are the chapter table’s own, and LEVEL_REV_BASE is there', () => {
    expect(engine.kindOfLevel).toBe(config.kindOfLevel);
    expect(engine.levelRev).toBe(config.levelRev);
    expect(engine.BOSS).toBe(config.BOSS);
    expect(engine.LEVEL_REV_BASE).toBe(2);
    expect(engine.LEVEL_KINDS).toContain(engine.kindOfLevel(1));
  });

  it('the builder’s knobs stay out of the index', () => {
    for (const name of ['levelPlan', 'FILL_BOX_BANDS', 'chapterKinds', 'LEVEL_REVS', 'levelSeed'])
      expect([name, name in engine]).toEqual([name, false]);
  });

  it('the 1.0.3 modules are exported: the puzzle, its host, the shared host, the boss', () => {
    expect(typeof engine.createPuzzle).toBe('function');
    expect(typeof engine.puzzleExplainSteps).toBe('function');
    expect(typeof engine.LocalPuzzleHost).toBe('function');
    expect(typeof engine.LocalLevelHost).toBe('function');
    expect(typeof engine.bossTraits).toBe('function');
    expect(typeof engine.fillRegionOf).toBe('function');
    expect(typeof engine.maxMsOf).toBe('function');
  });

  it('ENGINE_VERSION 0.4.0 (1.0.3: three new kinds the server must know)', () => {
    expect(engine.ENGINE_VERSION).toBe('0.4.0');
  });
});
