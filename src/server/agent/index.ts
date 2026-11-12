import 'server-only';

/**
 * The agent module's only public surface. Outside this folder nothing imports
 * the Anthropic SDK, the prompt or the tool definitions
 * (agentBoundaryGuard.test.ts).
 */
export { callAnthropic, type CallModel, type ModelFailure, type ModelReply } from './anthropic';
export { runAgent, MAX_MODEL_CALLS, type AgentDeps, type AgentResult } from './loop';
export { scanIntent, type ScanResult } from './scan';
export { readPriorities, type PrioritiesResult } from './priorities';
export type { AgentInput, HotelOnScreen } from './prompt';
