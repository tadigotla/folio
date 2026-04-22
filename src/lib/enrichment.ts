import { getDb } from './db';

const DEFAULT_HOST = 'http://localhost:11434';
const DEFAULT_MODEL = 'gemma3:4b';

const PROMPT_SYSTEM = `You summarize YouTube videos for a personal reading-queue app.
Given the video's title, channel, description, and (optional) transcript, produce a
compact JSON object describing the video. Respond with ONLY the JSON — no prose, no
code fences. Schema:
{
  "summary":    string,   // ~50 words, plain prose. Describe what the video is *about*, not what will happen in it.
  "topic_tags": string[]  // Exactly 3 short lowercase tags. Prefer concrete topics ("cast-iron metallurgy") over genres ("tutorial").
}`;

export interface EnrichmentInput {
  videoId: string;
  title: string;
  channel: string;
  description: string | null;
  transcript: string | null;
}

export interface EnrichmentResult {
  summary: string;
  topic_tags: [string, string, string];
}

export class OllamaUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OllamaUnavailableError';
  }
}

export function getOllamaConfig() {
  return {
    host: process.env.OLLAMA_HOST ?? DEFAULT_HOST,
    model: process.env.OLLAMA_ENRICHMENT_MODEL ?? DEFAULT_MODEL,
  };
}

function buildUserPrompt(input: EnrichmentInput): string {
  const desc = (input.description ?? '').slice(0, 800);
  const tx = input.transcript ? input.transcript.slice(0, 4000) : '';
  return [
    `Title: ${input.title}`,
    `Channel: ${input.channel}`,
    desc ? `Description:\n${desc}` : '',
    tx ? `Transcript (partial):\n${tx}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}

function extractJson(raw: string): string {
  let s = raw.trim();
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '').trim();
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start >= 0 && end > start) return s.slice(start, end + 1);
  return s;
}

function parseResult(raw: string): EnrichmentResult | null {
  try {
    const parsed: unknown = JSON.parse(extractJson(raw));
    if (typeof parsed !== 'object' || parsed === null) return null;
    const obj = parsed as { summary?: unknown; topic_tags?: unknown };
    const summary = typeof obj.summary === 'string' ? obj.summary.trim() : '';
    const tags: string[] = Array.isArray(obj.topic_tags)
      ? obj.topic_tags.map((t: unknown) => String(t).trim().toLowerCase()).filter(Boolean)
      : [];
    if (!summary) return null;
    if (tags.length < 1) return null;
    while (tags.length < 3) tags.push(tags[tags.length - 1] ?? 'misc');
    const three = tags.slice(0, 3) as [string, string, string];
    return { summary, topic_tags: three };
  } catch {
    return null;
  }
}

async function callOllamaOnce(
  host: string,
  model: string,
  userPrompt: string
): Promise<string> {
  let res: Response;
  try {
    res = await fetch(`${host}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        stream: false,
        format: 'json',
        messages: [
          { role: 'system', content: PROMPT_SYSTEM },
          { role: 'user', content: userPrompt },
        ],
        options: { temperature: 0.2 },
      }),
    });
  } catch (err) {
    throw new OllamaUnavailableError(
      `Could not reach Ollama at ${host}. See RUNBOOK "Taste substrate" for setup. Underlying: ${String(err)}`
    );
  }

  if (res.status === 404) {
    throw new OllamaUnavailableError(
      `Ollama reported model '${model}' not found. Pull it with \`ollama pull ${model}\` or set OLLAMA_ENRICHMENT_MODEL to one of \`ollama list\`. See RUNBOOK "Taste substrate".`
    );
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Ollama ${res.status}: ${body.slice(0, 500)}`);
  }

  const json = (await res.json()) as { message?: { content?: string } };
  return json.message?.content ?? '';
}

export async function enrichOne(input: EnrichmentInput): Promise<EnrichmentResult | null> {
  const { host, model } = getOllamaConfig();
  const userPrompt = buildUserPrompt(input);
  const first = await callOllamaOnce(host, model, userPrompt);
  const parsed = parseResult(first);
  if (parsed) return parsed;
  // Retry once if the model returned malformed JSON.
  const second = await callOllamaOnce(host, model, userPrompt);
  return parseResult(second);
}

export function storeEnrichment(videoId: string, model: string, result: EnrichmentResult) {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT OR REPLACE INTO video_enrichment
       (video_id, model, summary, topic_tags, created_at, run_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    videoId,
    model,
    result.summary,
    JSON.stringify(result.topic_tags),
    now,
    now
  );
}

export interface PendingEnrichmentRow {
  id: string;
  title: string;
  description: string | null;
  channel: string;
  transcript: string | null;
}

export function listVideosMissingEnrichment(): PendingEnrichmentRow[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT v.id, v.title, v.description, c.name AS channel,
              t.text AS transcript
         FROM videos v
         JOIN channels c ON c.id = v.channel_id
         LEFT JOIN video_enrichment e ON e.video_id = v.id
         LEFT JOIN video_transcripts t ON t.video_id = v.id
        WHERE e.video_id IS NULL
        ORDER BY v.first_seen_at DESC`
    )
    .all() as PendingEnrichmentRow[];
}
