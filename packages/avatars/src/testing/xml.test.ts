import { checkXml, duplicates } from './xml';

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

  it('finds duplicates', () => {
    expect(duplicates(['a', 'b', 'a', 'c', 'b'])).toEqual(['a', 'b']);
    expect(duplicates(['a', 'b'])).toEqual([]);
  });
});
