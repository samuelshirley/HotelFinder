import 'server-only';

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

export async function deliverCode(email: string, code: string): Promise<Delivery | null> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return process.env.NODE_ENV === 'production' ? null : { via: 'dev_mailbox', code };
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        from: FROM,
        to: [email],
        subject: `${code} is your Hotel finder code`,
        text: `Your sign-in code is ${code}. It works once, for 10 minutes.\n\nIf you did not ask for it, ignore this email.`,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) console.error('[mailer] resend refused', res.status);
    return res.ok ? { via: 'email' } : null;
  } catch (err) {
    console.error('[mailer] resend failed', (err as Error).name);
    return null;
  }
}
