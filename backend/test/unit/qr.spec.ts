import * as path from 'path';

/* PART 6 — vendor किए गए QR generator (app/src/main/assets/qr.js) की असली जाँच.
 *
 * qr.js = qrcode-generator (Kazuhiko Arase, MIT) + POSQR wrapper. यह स्पेक
 * पूरे matrix को jsQR (pure JS decoder) से फिर decode करके prove करता है कि
 * बना QR असल में सही दुकान का URL स्कैन कराता है — बत्ती-दो टुक डेमो QR नहीं.
 * jsqr test-only devDependency है; APK में कुछ नहीं जाता.
 */

/* eslint-disable @typescript-eslint/no-var-requires */
const qrjs = require(path.join(__dirname, '..', '..', '..', 'app', 'src', 'main', 'assets', 'qr.js')) as {
  POSQR?: { make(text: string, ec?: string): { size: number; isDark(r: number, c: number): boolean } };
};

interface DecodeResult { data: string; version: number }
type DecodeFn = (data: Uint8ClampedArray, w: number, h: number) => DecodeResult | null;

const jsqrRaw = require('jsqr') as DecodeFn | { default?: DecodeFn };
const jsQR: DecodeFn | undefined = typeof jsqrRaw === 'function' ? jsqrRaw : jsqrRaw.default;

/** matrix → RGBA bitmap (white bg, black modules, border quiet-zone, scale px/module). */
function bitmap(m: { size: number; isDark(r: number, c: number): boolean }, border: number, scale: number) {
  const W = (m.size + 2 * border) * scale;
  const data = new Uint8ClampedArray(W * W * 4).fill(255);
  const paint = (r: number, c: number) => {
    for (let dy = 0; dy < scale; dy++) {
      for (let dx = 0; dx < scale; dx++) {
        const i = (((r + border) * scale + dy) * W + (c + border) * scale + dx) * 4;
        data[i] = 0; data[i + 1] = 0; data[i + 2] = 0;
      }
    }
  };
  for (let r = 0; r < m.size; r++) for (let c = 0; c < m.size; c++) if (m.isDark(r, c)) paint(r, c);
  return { data, W };
}

function decode(text: string, border = 4, scale = 4): string | undefined {
  const POSQR = qrjs.POSQR!;
  const { data, W } = bitmap(POSQR.make(text, 'M'), border, scale);
  const res = jsQR!(data, W, W);
  return res ? res.data : undefined;
}

describe('POSQR (_assets/qr.js) — decode round-trip जाँच', () => {
  const POSQR = qrjs.POSQR;
  it('qr.js vendor हुआ है और POSQR expose करता है', () => expect(POSQR).toBeTruthy());

  if (!POSQR || !jsQR) return;

  const PUB = 'https://dukan.example.com/s/';

  it('सामान्य URL → decode = वही URL (correct shop का proof)', () => {
    const t = PUB + 'sharma-kirana';
    const m = POSQR.make(t, 'M');
    expect(m.size).toBeGreaterThanOrEqual(21);
    expect(decode(t)).toBe(t);
  });

  it('Devanagari percent-encoded slug भी सही decode होता है', () => {
    const t = PUB + encodeURIComponent('दुकान');
    expect(decode(t)).toBe(t);
  });

  it('दो अलग दुकानों के QR अलग-अलग decode होते हैं (इक-दूसरे पर नहीं)', () => {
    const a = PUB + 'sharma-kirana';
    const b = PUB + 'sharma-kirana-2';
    expect(decode(a)).toBe(a);
    expect(decode(b)).toBe(b);
    expect(decode(a)).not.toBe(b);
  });

  it('लंबे URL (high version) भी decode होते हैं', () => {
    const t = 'https://dukaan-operator.example.in/s/rajkirana-store-and-general-items-2';
    const m = POSQR.make(t, 'M');
    expect(m.size).toBeGreaterThan(29);
    expect(decode(t)).toBe(t);
  });

  it('UTF-8 (Devanagari raw string) round-trip — byte-mode सही', () => {
    expect(decode('नमस्ते दुकान', 4, 6)).toBe('नमस्ते दुकान');
  });
});
