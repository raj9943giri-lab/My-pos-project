import * as fs from 'fs';
import * as path from 'path';

/**
 * हल्का .env loader — कोई नया dependency नहीं.
 *
 * पहले process.env में जो है वही जीतता है (tests/CI/deployment env override),
 * बाक़ी keys `.env` से भरती हैं. फ़ाइल न मिले तो चुपचाप आगे.
 *
 * __dirname वाली paths दोनों हालत में काम करती हैं:
 *   ts-jest  : backend/src/config  → ../../../ = POS/
 *   nest build: backend/dist/config → ../../../ = POS/
 */
function parseLine(line: string): [string, string] | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) return null;
  const eq = trimmed.indexOf('=');
  if (eq <= 0) return null;
  let key = trimmed.slice(0, eq).trim();
  if (key.startsWith('export ')) key = key.slice(7).trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return null;
  let value = trimmed.slice(eq + 1).trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1);
  }
  return [key, value];
}

export function loadDotEnv(): void {
  const candidates = [
    path.resolve(process.cwd(), '.env'),
    path.resolve(process.cwd(), 'backend/.env'),
    path.resolve(__dirname, '../../../.env'),
    path.resolve(__dirname, '../../../backend/.env'),
  ];
  const seen = new Set<string>();
  for (const file of candidates) {
    if (seen.has(file)) continue;
    seen.add(file);
    let content: string;
    try {
      content = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    for (const line of content.split(/\r?\n/)) {
      const parsed = parseLine(line);
      if (!parsed) continue;
      const [key, value] = parsed;
      if (process.env[key] === undefined) process.env[key] = value;
    }
  }
}
