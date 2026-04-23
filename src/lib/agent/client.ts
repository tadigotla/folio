import Anthropic from '@anthropic-ai/sdk';

export class AgentKeyMissingError extends Error {
  constructor() {
    super('ANTHROPIC_API_KEY is not set. See RUNBOOK "Curation agent".');
    this.name = 'AgentKeyMissingError';
  }
}

let _client: Anthropic | null = null;

export function getAnthropic(): Anthropic {
  if (_client) return _client;
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new AgentKeyMissingError();
  _client = new Anthropic({ apiKey: key });
  return _client;
}

export function hasApiKey(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

export function getAgentModel(): string {
  return process.env.AGENT_MODEL ?? 'claude-sonnet-4-6';
}

export function getAgentMaxTurns(): number {
  const raw = process.env.AGENT_MAX_TURNS;
  const n = raw ? Number(raw) : NaN;
  return Number.isInteger(n) && n > 0 ? n : 10;
}
