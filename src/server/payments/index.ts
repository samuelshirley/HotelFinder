import 'server-only';

/**
 * BOUNDED MODULE: the one place that decides how a booking is paid.
 *
 * Today there is one way, `test`: the Apple Pay and Google Pay sheets are
 * mocks, no money moves, and the supplier books with its sandbox-only test
 * method. It exists only while the supplier key is a sandbox key; with any
 * other key there is no way to pay until the real wallet path is built
 * (LiteAPI's payment SDK), and checkout says so instead of pretending.
 */
export const WALLETS = ['apple_pay', 'google_pay'] as const;
export type Wallet = (typeof WALLETS)[number];

export type PaymentMode = 'test' | 'none';

export function paymentMode(supplierKey = process.env.LITE_API_KEY ?? ''): PaymentMode {
  return supplierKey.startsWith('sand_') ? 'test' : 'none';
}

export type PaymentResult = { ok: true; test: true } | { ok: false; error: 'payment_unavailable' };

/** Takes the payment for a booking. In `test` mode nothing is charged. */
export async function takePayment(_args: { wallet: Wallet; amountMinor: number; currency: string }, mode = paymentMode()): Promise<PaymentResult> {
  if (mode !== 'test') return { ok: false, error: 'payment_unavailable' };
  return { ok: true, test: true };
}
