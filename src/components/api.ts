import type { Action } from '@/lib/store/actions';
import type { Brief } from '@/server/brief';
import type { FormAnswer } from '@/server/onboarding';
import type { SessionView } from '@/server/view';

/** The browser's calls to the API. Every failure becomes an error code the UI has copy for. */

export class ApiError extends Error {
  constructor(public code: string) {
    super(code);
  }
}

export const todayLocal = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) } });
  } catch {
    throw new ApiError('network');
  }
  const body = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok || !body) throw new ApiError(body?.error ?? 'server_error');
  return body;
}

export const createSession = () => request<{ sessionId: string }>('/api/session', { method: 'POST', body: '{}' });
export type Trip = { id: string; status: string; destination: string; checkIn: string; checkOut: string };
export const loadTrips = () => request<{ trips: Trip[] }>('/api/session');
export const loadSession = (id: string) => request<SessionView>(`/api/session/${id}`);
export const answerForm = (id: string, answer: FormAnswer) =>
  request<SessionView>(`/api/session/${id}/form`, { method: 'POST', body: JSON.stringify({ answer, today: todayLocal() }) });
/** The results header's chips: nationality, what "best" means, where "close" is from. */
export type EditAction = Extract<Action, { type: 'set_destination' | 'set_dates' | 'set_guests' | 'add_must_have' | 'remove_must_have' | 'set_nationality' | 'set_priorities' | 'set_near' | 'clear_near' }>;
export const editSearch = (id: string, actions: EditAction | EditAction[]) =>
  request<SessionView>(`/api/session/${id}/edit`, { method: 'POST', body: JSON.stringify({ actions: Array.isArray(actions) ? actions : [actions], today: todayLocal() }) });
export type PlaceSuggestion = { placeId: string; label: string; name: string; where: string | null; kind: string };
export const searchPlaces = (q: string) => request<{ places: PlaceSuggestion[] }>(`/api/places?q=${encodeURIComponent(q)}`);
export type { Example } from '@/server/example';
export const loadExample = () => request<import('@/server/example').Example>('/api/example');
export const startBrief = (brief: Brief) => request<{ sessionId: string }>('/api/session/brief', { method: 'POST', body: JSON.stringify({ brief, today: todayLocal() }) });

export type PropertyDetails = {
  id: string;
  name: string;
  address: string | null;
  stars: number | null;
  rating: number | null;
  reviewCount: number | null;
  description: string | null;
  importantInformation: string | null;
  facilities: string[];
  imageUrls: string[];
  petsAllowed: boolean | null;
  parking: string | null;
};
export const loadProperty = (sessionId: string, propertyId: string) => request<PropertyDetails>(`/api/session/${sessionId}/property/${propertyId}`);

/**
 * Send one chat message and wait for the stream to end. The idempotency key
 * is made by the caller once per message, so a retry cannot run it twice.
 */
export async function sendTurn(id: string, message: string, idempotencyKey: string, onEvent: (type: string) => void): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`/api/session/${id}/turn`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message, idempotencyKey, today: todayLocal() }),
    });
  } catch {
    throw new ApiError('network');
  }
  if (!res.ok || !res.body) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new ApiError(body?.error ?? 'server_error');
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read().catch(() => ({ done: true, value: undefined }));
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let cut: number;
    while ((cut = buffer.indexOf('\n\n')) >= 0) {
      const line = buffer.slice(0, cut).replace(/^data: /, '');
      buffer = buffer.slice(cut + 2);
      try {
        onEvent((JSON.parse(line) as { type: string }).type);
      } catch {
        // a partial frame; the session view is the source of truth anyway
      }
    }
  }
}
