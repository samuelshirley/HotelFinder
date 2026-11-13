/**
 * Every API route, its methods, and the spec that tests it. e2e/api/coverage.spec.ts
 * reads src/app/api/** /route.ts and fails if a route or a method is missing
 * here, or if the named spec does not test "<METHOD> <path>" by that title. A
 * new route therefore cannot ship without an API test.
 */
export type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export type RouteEntry = {
  /** The route file's folder under src/app/api, as written: `session/[id]/form`. */
  route: string;
  methods: Method[];
  /** The spec that tests it, under e2e/api/. */
  spec: string;
  /** A concrete path to call it on with any id (for the wrong-method and malformed-body sweeps). */
  sample: string;
};

const Z = '00000000-0000-4000-8000-000000000000';

export const ROUTES: RouteEntry[] = [
  { route: 'auth/code', methods: ['POST'], spec: 'auth.spec.ts', sample: 'api/auth/code' },
  { route: 'auth/sign-out', methods: ['POST'], spec: 'auth.spec.ts', sample: 'api/auth/sign-out' },
  { route: 'auth/verify', methods: ['POST'], spec: 'auth.spec.ts', sample: 'api/auth/verify' },
  { route: 'booking/[id]', methods: ['GET'], spec: 'booking.spec.ts', sample: `api/booking/${Z}` },
  { route: 'booking/[id]/cancel', methods: ['POST'], spec: 'booking.spec.ts', sample: `api/booking/${Z}/cancel` },
  { route: 'booking/[id]/confirm', methods: ['POST'], spec: 'booking.spec.ts', sample: `api/booking/${Z}/confirm` },
  { route: 'bookings', methods: ['GET'], spec: 'booking.spec.ts', sample: 'api/bookings' },
  { route: 'events', methods: ['POST'], spec: 'session.spec.ts', sample: 'api/events' },
  { route: 'example', methods: ['GET'], spec: 'public.spec.ts', sample: 'api/example' },
  { route: 'health', methods: ['GET'], spec: 'public.spec.ts', sample: 'api/health' },
  { route: 'me', methods: ['GET'], spec: 'auth.spec.ts', sample: 'api/me' },
  { route: 'places', methods: ['GET'], spec: 'public.spec.ts', sample: 'api/places?q=porto' },
  { route: 'session', methods: ['GET', 'POST'], spec: 'session.spec.ts', sample: 'api/session' },
  { route: 'session/brief', methods: ['POST'], spec: 'session.spec.ts', sample: 'api/session/brief' },
  { route: 'session/[id]', methods: ['GET'], spec: 'session.spec.ts', sample: `api/session/${Z}` },
  { route: 'session/[id]/checkout', methods: ['POST'], spec: 'booking.spec.ts', sample: `api/session/${Z}/checkout` },
  { route: 'session/[id]/edit', methods: ['POST'], spec: 'session.spec.ts', sample: `api/session/${Z}/edit` },
  { route: 'session/[id]/form', methods: ['POST'], spec: 'session.spec.ts', sample: `api/session/${Z}/form` },
  { route: 'session/[id]/property/[propertyId]', methods: ['GET'], spec: 'property.spec.ts', sample: `api/session/${Z}/property/${Z}` },
  { route: 'session/[id]/property/[propertyId]/rates', methods: ['GET'], spec: 'property.spec.ts', sample: `api/session/${Z}/property/${Z}/rates` },
  { route: 'session/[id]/turn', methods: ['POST'], spec: 'turn.spec.ts', sample: `api/session/${Z}/turn` },
  { route: 'session/[id]/turns', methods: ['GET'], spec: 'turn.spec.ts', sample: `api/session/${Z}/turns` },
];

/** "POST /api/session/[id]/form": the title a spec gives the describe block that tests it. */
export const titleOf = (route: string, method: Method) => `${method} /api/${route}`;
