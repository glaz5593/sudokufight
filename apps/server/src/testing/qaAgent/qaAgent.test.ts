import type { AdminQaItem, AdminQaRun } from '@sudoku-fight/protocol';

import {
  centerOf,
  describeNodes,
  findNode,
  formatItem,
  formatRun,
  parseUiDump,
  readToken,
  serverUrlOf,
} from './index';

const DUMP = `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?><hierarchy rotation="0">
<node index="0" text="" resource-id="" class="android.widget.FrameLayout" content-desc="" clickable="false" bounds="[0,0][1080,2400]">
<node index="1" text="משחק חדש" resource-id="com.mosheg.sudokufight:id/home-new-game" class="android.widget.TextView" content-desc="" clickable="true" bounds="[100,200][980,320]" />
<node index="2" text="A &amp; B &quot;C&quot; &#1488;" resource-id="" class="android.widget.TextView" content-desc="" clickable="false" bounds="[0,400][500,450]" />
<node index="3" text="" resource-id="" class="android.view.View" content-desc="הגדרות" clickable="true" bounds="[900,40][1040,180]" />
<node index="4" text="משחק חדש עם חברים" resource-id="" class="android.widget.TextView" content-desc="" clickable="true" bounds="[100,600][980,700]" />
</node></hierarchy>`;

describe('the ADB screen dump', () => {
  it('keeps the views with a text, a description, an id or a click, unescaped, with their bounds', () => {
    const nodes = parseUiDump(DUMP);
    expect(nodes.map((n) => n.text || n.desc)).toEqual([
      'משחק חדש',
      'A & B "C" א',
      'הגדרות',
      'משחק חדש עם חברים',
    ]);
    expect(nodes[0]).toMatchObject({ clickable: true, bounds: [100, 200, 980, 320] });
    expect(centerOf(nodes[0]!)).toEqual({ x: 540, y: 260 });
  });

  it('finds an exact text, description or testID before a view that only contains it', () => {
    const nodes = parseUiDump(DUMP);
    expect(findNode(nodes, 'משחק חדש')?.bounds).toEqual([100, 200, 980, 320]);
    expect(findNode(nodes, 'הגדרות')?.desc).toBe('הגדרות');
    expect(findNode(nodes, 'home-new-game')?.text).toBe('משחק חדש');
    expect(findNode(nodes, 'עם חברים')?.text).toBe('משחק חדש עם חברים');
    expect(findNode(nodes, 'אין כזה')).toBeNull();
    expect(findNode(nodes, '  ')).toBeNull();
  });

  it('reads the screen as short lines: label, centre, and whether it takes a tap', () => {
    expect(describeNodes(parseUiDump(DUMP))[0]).toBe('"משחק חדש" id=home-new-game @540,260 [tap]');
  });
});

describe('the API side', () => {
  it('a server by name or URL; anything else is refused', () => {
    expect(serverUrlOf('staging')).toBe('https://sudoku-fight-staging.fly.dev');
    expect(serverUrlOf('local')).toBe('http://localhost:2567');
    expect(serverUrlOf('http://192.168.1.5:2567/')).toBe('http://192.168.1.5:2567');
    expect(() => serverUrlOf('prod')).toThrow('unknown server');
  });

  it('the key comes from its file, trimmed; an error names the file and never shows the key', () => {
    const key = 'k'.repeat(40);
    expect(readToken('/x/qa-agent.token', () => `${key}\r\n`)).toBe(key);
    expect(() => readToken('/x/qa-agent.token', () => 'short')).toThrow(/shorter than 32/);
    expect(() =>
      readToken('/x/qa-agent.token', () => {
        throw new Error('ENOENT');
      }),
    ).toThrow('no agent key in /x/qa-agent.token');
  });

  it('prints a run and a task the way Claude reads them', () => {
    const run = {
      id: 3,
      title: 'בדיקה',
      appVersion: '1.0.5',
      device: 'Pixel',
      platform: 'android',
      status: 'open',
      counts: { total: 4, untested: 1, pass: 1, partial: 1, fail: 1, openBugs: 2, handled: 0 },
    } as AdminQaRun;
    expect(formatRun(run)).toBe(
      '#3 [open] בדיקה (1.0.5 · android · Pixel) V 1 · ½ 1 · X 1 · · 1 / 4; bugs open 2, handled 0',
    );
    const item = {
      taskId: 'friends-room-create',
      who: 'claude',
      title: 'יצירת חדר',
      categoryTitle: 'חברים',
      subcategoryTitle: 'חדר',
      steps: ['פותחים', 'לוחצים'],
      expected: ['רואים קוד'],
      result: 'fail',
      actual: 'אין קוד',
      note: null,
      bugStatus: 'handled',
      fixNote: 'תוקן',
      fixedIn: '1.0.5',
    } as AdminQaItem;
    expect(formatItem(item)).toBe('X friends-room-create [claude] יצירת חדר {handled}');
    expect(formatItem(item, true).split('\n')).toEqual([
      'X friends-room-create [claude] יצירת חדר {handled}',
      '  חברים › חדר',
      '  1. פותחים',
      '  2. לוחצים',
      '  ✓ רואים קוד',
      '  בפועל: אין קוד',
      '  טופל (1.0.5): תוקן',
    ]);
  });
});
