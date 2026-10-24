/**
 * Termux/Android (arm64) पर Next.js का native SWC binary नहीं है. Next 14 में
 * `experimental.useWasmBinary` सिर्फ़ client compiler से पहले लागू होता है —
 * server compiler पहले चलने पर वह सीधे native binding माँगता है और crash करता है.
 *
 * यह prelude Next CLI से पहले उसी process में WASM binding eagerly load कर देता
 * है (module-level pendingBindings cache), इसलिए आगे के सभी loadBindings()
 * calls WASM पर जाते हैं. सिर्फ़ unsupported platform पर काम करता है; बाक़ी
 * जगह native SWC ही इस्तेमाल होगा.
 */
const os = require('os');

const unsupported = os.platform() === 'android';
if (unsupported) {
  try {
    const swc = require('next/dist/build/swc');
    // Promise को await करने की ज़रूरत नहीं: loadBindings() pendingBindings को
    // synchronously set करता है, जो बाद के calls को वही WASM binding देता है.
    swc.loadBindings(true).catch((err) => {
      console.error('[next-wasm-prelude] WASM SWC load failed:', err && err.message ? err.message : err);
      process.exit(1);
    });
  } catch (err) {
    console.error('[next-wasm-prelude] could not load next swc module:', err && err.message ? err.message : err);
    process.exit(1);
  }
}
