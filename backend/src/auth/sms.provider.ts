/**
 * SMS provider abstraction.
 *  - console: DEV-ONLY. No SMS, no code logging; the API response may include
 *             devCode only in non-production so the app's DEV banner can show it.
 *  - http:    generic JSON gateway: POST SMS_API_URL { to: "9198…", text, sender }
 *             with Authorization: Bearer SMS_API_KEY.
 * msg91 / Twilio adapters: implement this interface (2 small classes), docs in backend/README.md.
 */
import { env } from '../config/env';

export interface SmsProvider {
  send(digits: string, text: string): Promise<void>;
}

class ConsoleSmsProvider implements SmsProvider {
  /** DEV-ONLY: no network, code NOT logged here (screen banner gets it from response). */
  async send(_digits: string, _text: string): Promise<void> {
    return Promise.resolve();
  }
}

class HttpSmsProvider implements SmsProvider {
  async send(digits: string, text: string): Promise<void> {
    if (!env.SMS_API_URL) throw new Error('SMS_API_URL not configured');
    const res = await fetch(env.SMS_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + env.SMS_API_KEY,
      },
      body: JSON.stringify({ to: digits, text, sender: env.SMS_SENDER }),
    });
    if (!res.ok) throw new Error('SMS gateway failed: ' + res.status);
  }
}

export function smsProvider(): SmsProvider {
  return env.SMS_PROVIDER === 'http' ? new HttpSmsProvider() : new ConsoleSmsProvider();
}
