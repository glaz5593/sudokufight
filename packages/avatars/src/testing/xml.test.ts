import { checkXml, duplicates, xmlTree } from './xml';

describe('checkXml (the tests’ well-formedness check)', () => {
  it('accepts well-formed markup and lists elements and ids', () => {
    const r = checkXml('<svg a="1"><g id="x"><path d="M0 0"/></g><!-- c --><g id="y">a &amp; b</g></svg>');
    expect(r.root).toBe('svg');
    expect(r.elements.map((e) => e.name)).toEqual(['svg', 'g', 'path', 'g']);
    expect(r.ids).toEqual(['x', 'y']);
  });

  it.each([
    ['unclosed tag', '<svg><g></svg>'],
    ['mismatched close', '<svg><g></path></svg>'],
    ['unquoted attribute', '<svg a=1></svg>'],
    ['duplicate attribute', '<svg a="1" a="2"></svg>'],
    ['raw ampersand', '<svg>a & b</svg>'],
    ['ampersand in attribute', '<svg a="x&y"></svg>'],
    ['two roots', '<svg/><svg/>'],
    ['text outside the root', 'hi<svg/>'],
    ['no root', '   '],
    ['bad tag name', '<1svg/>'],
  ])('rejects %s', (_, xml) => {
    expect(() => checkXml(xml)).toThrow();
  });

  it('builds the element tree', () => {
    const t = xmlTree(
      '<svg xmlns="http://www.w3.org/2000/svg"><g a="1"><path d="M0 0"/><!-- c --></g><rect/></svg>',
    );
    expect(t.name).toBe('svg');
    expect(t.attrs).toEqual({ xmlns: 'http://www.w3.org/2000/svg' });
    expect(t.children.map((c) => c.name)).toEqual(['g', 'rect']);
    expect(t.children[0]?.attrs).toEqual({ a: '1' });
    expect(t.children[0]?.children.map((c) => [c.name, c.attrs])).toEqual([['path', { d: 'M0 0' }]]);
    expect(() => xmlTree('<svg><g></svg>')).toThrow();
  });

  it('finds duplicates', () => {
    expect(duplicates(['a', 'b', 'a', 'c', 'b'])).toEqual(['a', 'b']);
    expect(duplicates(['a', 'b'])).toEqual([]);
  });
});
