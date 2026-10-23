import { MOVEMENT_KINDS, normalizeKind, sanitizeNote } from '../../src/inventory/movements';

describe('normalizeKind (movement whitelist)', () => {
  it('passes listed kinds through (case-insensitive)', () => {
    expect(normalizeKind('RESTOCK')).toBe('RESTOCK');
    expect(normalizeKind('bulk')).toBe('BULK');
    expect(normalizeKind('Set')).toBe('SET');
  });
  it('unknown / missing kinds degrade to ADJUST (never poison the audit)', () => {
    expect(normalizeKind('HACKED')).toBe('ADJUST');
    expect(normalizeKind('')).toBe('ADJUST');
    expect(normalizeKind(undefined)).toBe('ADJUST');
    expect(normalizeKind(null)).toBe('ADJUST');
  });
  it('keeps the exposed list in sync', () => {
    // हर listed kind normalize से वही वापस आना चाहिए — अंतर ज़रूरी नहीं
    for (const k of MOVEMENT_KINDS) expect(normalizeKind(k)).toBe(k);
  });
});

describe('sanitizeNote (audit notes)', () => {
  it('trims whitespace', () => {
    expect(sanitizeNote('  सप्लाई से आया  ')).toBe('सप्लाई से आया');
  });
  it('blank becomes null', () => {
    expect(sanitizeNote('   ')).toBeNull();
    expect(sanitizeNote(undefined)).toBeNull();
    expect(sanitizeNote(null)).toBeNull();
  });
  it('caps the length at 140', () => {
    const long = 'x'.repeat(200);
    expect(sanitizeNote(long)).toHaveLength(140);
    expect(sanitizeNote('ab', 1)).toBe('a');
  });
  it('numbers are stringified', () => {
    expect(sanitizeNote(42)).toBe('42');
  });
});
