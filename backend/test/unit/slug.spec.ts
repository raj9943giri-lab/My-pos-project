import { slugify, slugCandidates, SLUG_RE } from '../../src/common/slug';

describe('slugify (slug generation)', () => {
  it('basic latin names → kebab-case', () => {
    expect(slugify('Rajesh Kirana Store')).toBe('rajesh-kirana-store');
  });
  it('spaces + punctuation collapse', () => {
    expect(slugify('  Sharma   Kirana,  & Sons! ')).toBe('sharma-kirana-sons');
  });
  it('Devanagari names are preserved (Part-1 parity)', () => {
    const s = slugify('मेरी दुकान');
    expect(s).toBe('मेरी-दुकान');
    expect(SLUG_RE.test(s)).toBe(true);
  });
  it('pure symbols → safe fallback', () => {
    expect(slugify('!@#$')).toBe('dukan');
  });
  it('long names truncate at 40', () => {
    expect(slugify('a b c d e f g h i j k l m n o p q r s t u v w x y z'.repeat(2)).length).toBeLessThanOrEqual(40);
  });
  it('two shops cannot claim same slug (candidates differ)', () => {
    const base = slugify('rajesh-kirana');
    expect(slugCandidates(base)).toEqual(['rajesh-kirana-2', 'rajesh-kirana-3', 'rajesh-kirana-4', 'rajesh-kirana-5']);
  });
});

describe('SLUG_RE (server-side slug validation)', () => {
  it('accepts latin + devanagari slugs', () => {
    expect(SLUG_RE.test('rajesh1')).toBe(true);
    expect(SLUG_RE.test('मेरी-दुकान')).toBe(true);
  });
  it('rejects spaces/uppercase/slash/empty', () => {
    expect(SLUG_RE.test('my shop')).toBe(false);
    expect(SLUG_RE.test('MyShop')).toBe(false);
    expect(SLUG_RE.test('../etc')).toBe(false);
    expect(SLUG_RE.test('a')).toBe(false); // न्यूनतम 2 chars (3+ typ: length 1 fail)
  });
});
