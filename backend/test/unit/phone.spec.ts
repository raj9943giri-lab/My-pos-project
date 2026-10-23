import { normalizeDigits, normalizeE164, isValidE164, maskPhone } from '../../src/common/phone';

describe('phone normalization (DB requirement: international format)', () => {
  it('10-digit Indian mobile → 919876543210 digits / +919876543210 E.164', () => {
    expect(normalizeDigits('9876543210')).toBe('919876543210');
    expect(normalizeE164('98765 43210')).toBe('+919876543210');
  });
  it('already prefixed 91 keeps', () => {
    expect(normalizeDigits('919876543210')).toBe('919876543210');
    expect(normalizeE164('919876543210')).toBe('+919876543210');
  });
  it('leading 0 normalized', () => {
    expect(normalizeDigits('09876543210')).toBe('919876543210');
  });
  it('rejects invalid numbers', () => {
    expect(normalizeDigits('12345')).toBeNull();
    expect(normalizeE164('abcd')).toBeNull();
    expect(isValidE164('+123')).toBe(false);
    expect(isValidE164('+919876543210')).toBe(true);
  });
  it('logging never exposes full number (masking)', () => {
    expect(maskPhone('919876543210')).toBe('+91987xxxxx10');
  });
});
