import 'server-only';

import { RESEND_PRICING } from '@/lib/supplierPrices';
import { logUsage } from '@/server/repos/usage';

/**
 * How a sign-in code reaches the person. With RESEND_API_KEY set, by email.
 * Without it, and only outside production, the code is handed back to the
 * page ("dev mailbox") so the flow can be used end to end; production with no
 * key sends nothing and says so.
 */
export type Delivery = { via: 'email' } | { via: 'dev_mailbox'; code: string };

// The app lives at feraltravels.com/hotels, and feraltravels.com is the domain verified in Resend
// (a sender on any other domain is refused with a 403: tried 2026-11-12).
const FROM = process.env.EMAIL_FROM ?? 'Hotel finder <hotels@feraltravels.com>';

/** Whether an email can be sent at all here. Without it, freeze reminders are shown on the booking page only. */
export const mailConfigured = (): boolean => Boolean(process.env.RESEND_API_KEY);

/**
 * One plain-text email through Resend, metered. False when it did not go out
 * (no key, refused, or no answer); never throws.
 */
export async function sendEmail(to: string, subject: string, text: string): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return false;
  const started = Date.now();
  const meter = (success: boolean, errorMessage: string | null) =>
    logUsage({ provider: 'resend:email', latencyMs: Date.now() - started, success, errorMessage, meta: { pricing: RESEND_PRICING } }).catch((err) =>
      console.error('[mailer] usage meter failed', (err as Error).name),
    );
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: FROM, to: [to], subject, text }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) console.error('[mailer] resend refused', res.status);
    await meter(res.ok, res.ok ? null : `status ${res.status}`);
    return res.ok;
  } catch (err) {
    console.error('[mailer] resend failed', (err as Error).name);
    await meter(false, (err as Error).name);
    return false;
  }
}

export async function deliverCode(email: string, code: string): Promise<Delivery | null> {
  if (!mailConfigured()) return process.env.NODE_ENV === 'production' ? null : { via: 'dev_mailbox', code };
  // One ledger row per send, failures included (docs/usage.md). No session: a code is asked for by an email address.
  const sent = await sendEmail(
    email,
    `${code} is your Hotel finder code`,
    `Your sign-in code is ${code}. It works once, for 10 minutes.\n\nIf you did not ask for it, ignore this email.`,
  );
  return sent ? { via: 'email' } : null;
}
