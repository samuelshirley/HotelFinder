import 'server-only';
import { placeName } from '@/lib/finder/searchPlan';

import type { ModelId } from '@/lib/models';
import type { Action } from '@/lib/store/actions';
import { previewReduce, type Rejection } from '@/lib/store/reduce';
import type { Place, SupplierResult } from '@/server/supplier';
import type { Block, CallModel, ModelFailure, ModelReply, ToolResult, Turn } from './anthropic';
import { checkReply, tidy, type Guard } from './guards';
import { buildUserTurn, SYSTEM, type AgentInput } from './prompt';
import { parseToolCall, TOOL_DEFS, type ToolContext } from './tools';

/**
 * The agent: the stop for every message the router did not settle. It reads
 * the search as data, may look two things up, and otherwise only QUEUES typed
 * actions. It applies nothing. The caller dispatches the queue through the
 * one path every change takes and reports what actually happened.
 *
 * Its own words reach the user only when it changed nothing (an answer or a
 * question), and only if they pass the reply guards.
 */
export const MAX_MODEL_CALLS = 4;
const MAX_TOKENS = 500;
const DETAILS_CHARS = 2400;

export type AgentDeps = {
  callModel: CallModel;
  model: ModelId;
  searchPlaces: (query: string) => Promise<SupplierResult<Place[]>>;
  /** The hotel's own listing as plain text, or null when it could not be read. */
  hotelDetails: (propertyId: string) => Promise<string | null>;
};

export type AgentResult = {
  actions: Action[];
  /** Validation failures the model was told about and did not fix. */
  rejected: Rejection[];
  /** A hotel to open in the panel. */
  open: string | null;
  /** The model's own reply, already guarded. '' when there is none to show. */
  text: string;
  guards: Guard[];
  failure: ModelFailure | null;
  replies: ModelReply[];
  toolTrace: Array<{ tool: string; outcome: string }>;
};

export async function runAgent(input: AgentInput & { shortlist: ToolContext['shortlist'] }, deps: AgentDeps): Promise<AgentResult> {
  // The agent only ever runs on a search that is already running (onboarding uses the scan).
  const ctx: ToolContext = { currency: input.currency, shortlist: input.shortlist, placeRefs: new Map(), searchTown: placeName(input.state.stay.destinationText) };
  const first = buildUserTurn(input);
  const messages: Turn[] = [{ role: 'user', content: first }];
  let grounding = first;
  let working = input.state;

  const result: AgentResult = { actions: [], rejected: [], open: null, text: '', guards: [], failure: null, replies: [], toolTrace: [] };
  let modelText = '';

  for (let call = 0; call < MAX_MODEL_CALLS; call++) {
    const reply = await deps.callModel({ model: deps.model, system: SYSTEM, messages, tools: TOOL_DEFS, maxTokens: MAX_TOKENS });
    result.replies.push(reply);
    if (!reply.ok) {
      result.failure = reply.failure;
      break;
    }
    const uses = reply.content.filter((b): b is Extract<Block, { type: 'tool_use' }> => b.type === 'tool_use');
    modelText = reply.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join(' ');
    if (uses.length === 0) break;

    const outputs: ToolResult[] = [];
    /** True when the model has something new to read, so it is asked again. */
    let lookedUp = false;
    for (const use of uses) {
      const parsed = parseToolCall(use.name, use.input, ctx);
      const answer = (content: string, isError = false) => {
        outputs.push({ type: 'tool_result', tool_use_id: use.id, content, ...(isError ? { is_error: true } : {}) });
        result.toolTrace.push({ tool: use.name, outcome: isError ? `error: ${content}` : content.length > 60 ? 'ok' : content });
      };
      switch (parsed.kind) {
        case 'invalid':
          answer(parsed.reason, true);
          lookedUp = true; // let the model see the refusal and correct itself
          break;
        case 'resolve_place': {
          lookedUp = true;
          const places = await deps.searchPlaces(parsed.query);
          if (!places.ok) {
            answer('The place search did not answer.', true);
            break;
          }
          if (places.value.length === 0) {
            answer('No place matches that.');
            break;
          }
          const lines = places.value.slice(0, 5).map((p) => {
            const ref = `P${ctx.placeRefs.size + 1}`;
            const label = p.address ? `${p.name}, ${p.address}` : p.name;
            ctx.placeRefs.set(ref, { placeId: p.placeId, label, types: p.types });
            return `${ref}: ${label.replace(/[<>]/g, ' ')}`;
          });
          const content = lines.join('\n');
          grounding += `\n${content}`;
          outputs.push({ type: 'tool_result', tool_use_id: use.id, content });
          result.toolTrace.push({ tool: use.name, outcome: `${lines.length} places` });
          break;
        }
        case 'hotel_details': {
          lookedUp = true;
          const details = await deps.hotelDetails(parsed.propertyId);
          if (details === null) {
            answer("The hotel's listing could not be read.", true);
            break;
          }
          const content = `<hotel_listing position="${parsed.position}">\n${details.replace(/[<>]/g, ' ').slice(0, DETAILS_CHARS)}\n</hotel_listing>`;
          grounding += `\n${content}`;
          outputs.push({ type: 'tool_result', tool_use_id: use.id, content });
          result.toolTrace.push({ tool: use.name, outcome: 'ok' });
          break;
        }
        case 'open':
          result.open = parsed.propertyId;
          answer('opened');
          break;
        case 'actions': {
          const notes: string[] = [];
          for (const action of parsed.actions) {
            const r = previewReduce(working, action, input.today);
            if (r.ok) {
              working = r.state;
              result.actions.push(action);
              notes.push('queued');
            } else {
              result.rejected.push(r.rejection);
              notes.push(`rejected: ${r.rejection}`);
            }
          }
          answer(notes.join(', '), notes.every((n) => n !== 'queued'));
          if (notes.some((n) => n !== 'queued')) lookedUp = true; // told why; it may correct itself
          break;
        }
      }
    }
    messages.push({ role: 'assistant', content: reply.content }, { role: 'user', content: outputs });
    // Only changes were asked for: the app reports them, so there is nothing more to ask the model.
    if (!lookedUp) {
      modelText = '';
      break;
    }
    modelText = '';
  }

  if (!result.failure) {
    const text = tidy(modelText);
    result.guards = checkReply(text, grounding);
    result.text = result.guards.length === 0 ? text : '';
  }
  return result;
}
