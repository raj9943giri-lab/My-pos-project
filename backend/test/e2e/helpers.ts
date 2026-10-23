/**
 * PART 7 — e2e helpers (jest testRegex सिर्फ़ *.spec.ts / *.e2e-spec.ts चलाता है,
 * इसलिए यह file suite नहीं बनता — सिर्फ़ import होता है).
 *
 * RolesGuard हर admin request पर admin_users से ताज़ा भूमिका पढ़ता है (ख़ाली/
 * भूत id के टोकन अब नहीं चलेंगे) — इसलिए e2e पहले एक असली admin row बोता है
 * और उसी id से टोकन mint करता है.
 */
export const E2E_ADMIN_ID = '11111111-2222-4333-8444-555555555555';
export const E2E_ADMIN_EMAIL = 'e2e-admin@pos.local';

interface MinimalDb { query: (sql: string, params?: any[]) => Promise<any> }

/** admin_users में SUPER_ADMIN row (email conflict से बचकर; हर बार id वही). */
export async function seedE2EAdmin(db: MinimalDb): Promise<void> {
  await db.query(
    `INSERT INTO admin_users (id, email, name, pwd_hash, role)
     VALUES ($1, $2, 'E2E एडमिन', 'e2e-not-a-real-hash', 'SUPER_ADMIN')
     ON CONFLICT (email) DO UPDATE SET role = 'SUPER_ADMIN', is_active = TRUE`,
    [E2E_ADMIN_ID, E2E_ADMIN_EMAIL],
  );
}

/** seeded admin के sub-से signed token (ADMIN_JWT_SECRET || JWT_SECRET). */
export function e2eAdminToken(secret: string | undefined): string {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require('jsonwebtoken').sign(
    { sub: E2E_ADMIN_ID, ad: E2E_ADMIN_EMAIL, rl: 'SUPER_ADMIN' },
    secret || 'dev-only-insecure-secret-0123456789abcdef',
  );
}
