'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { TurnContentBlock } from '../../lib/types';
import { Message } from './Message';
import { Composer } from './Composer';
import { AgentErrorBanner } from './AgentErrorBanner';
import type { RenderedTurn, ToolTrace } from './types';

interface Props {
  scopeDate: string;
}

interface StatusResponse {
  apiKeyPresent: boolean;
  model: string;
  youtubeSearchEnabled: boolean;
}

interface ConversationResponse {
  turns: RenderedTurn[];
}

type LiveRole = 'assistant';

interface LiveBubble {
  pendingId: string;
  role: LiveRole;
  text: string;
  traces: ToolTrace[];
}

type Phase = 'idle' | 'streaming';

function parseSSE(buffer: string): {
  events: { type: string; data: string }[];
  rest: string;
} {
  const events: { type: string; data: string }[] = [];
  const chunks = buffer.split('\n\n');
  const rest = chunks.pop() ?? '';
  for (const chunk of chunks) {
    let type = 'message';
    const dataLines: string[] = [];
    for (const line of chunk.split('\n')) {
      if (line.startsWith('event:')) type = line.slice(6).trim();
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
    }
    events.push({ type, data: dataLines.join('\n') });
  }
  return { events, rest };
}

export function ChatPanel({ scopeDate }: Props) {
  const router = useRouter();
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [turns, setTurns] = useState<RenderedTurn[]>([]);
  const [live, setLive] = useState<LiveBubble | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [composer, setComposer] = useState('');
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const [convRes, statusRes] = await Promise.all([
        fetch(`/api/agent/conversation/${scopeDate}`),
        fetch(`/api/agent/status`),
      ]);
      if (cancelled) return;
      if (convRes.ok) {
        const data = (await convRes.json()) as ConversationResponse;
        setTurns(data.turns);
      }
      if (statusRes.ok) {
        const data = (await statusRes.json()) as StatusResponse;
        setStatus(data);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [scopeDate]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [turns, live, phase]);

  const onSubmit = useCallback(async () => {
    const text = composer.trim();
    if (!text) return;
    setComposer('');
    setError(null);

    const pendingUserId = -Date.now();
    const userBlocks: TurnContentBlock[] = [{ type: 'text', text }];
    setTurns((prev) => [
      ...prev,
      {
        id: pendingUserId,
        role: 'user',
        blocks: userBlocks,
        createdAt: new Date().toISOString(),
      },
    ]);
    setLive({
      pendingId: `live-${Date.now()}`,
      role: 'assistant',
      text: '',
      traces: [],
    });
    setPhase('streaming');

    let res: Response;
    try {
      res = await fetch('/api/agent/message', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content: text }),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'network error');
      setPhase('idle');
      setLive(null);
      return;
    }

    if (!res.ok || !res.body) {
      let msg = `HTTP ${res.status}`;
      try {
        const body = await res.json();
        if (body && typeof body.error === 'string') msg = body.error;
      } catch {
        /* ignore */
      }
      setError(msg);
      setPhase('idle');
      setLive(null);
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let stateDirty = false;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const { events, rest } = parseSSE(buffer);
        buffer = rest;
        for (const e of events) {
          let payload: unknown;
          try {
            payload = JSON.parse(e.data);
          } catch {
            continue;
          }
          applyEvent(e.type, payload);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'stream error');
    } finally {
      setPhase('idle');
      setLive(null);
      if (stateDirty) router.refresh();
      try {
        const r = await fetch(`/api/agent/conversation/${scopeDate}`);
        if (r.ok) {
          const data = (await r.json()) as ConversationResponse;
          setTurns(data.turns);
        }
      } catch {
        /* ignore */
      }
    }

    function applyEvent(type: string, payload: unknown) {
      if (type === 'delta' && payload && typeof payload === 'object') {
        const { text: delta } = payload as { text: string };
        setLive((prev) =>
          prev ? { ...prev, text: prev.text + delta } : prev,
        );
      } else if (type === 'tool_call' && payload && typeof payload === 'object') {
        const p = payload as {
          tool_use_id: string;
          name: string;
          args: Record<string, unknown>;
        };
        setLive((prev) =>
          prev
            ? {
                ...prev,
                traces: [
                  ...prev.traces,
                  { tool_use_id: p.tool_use_id, name: p.name, args: p.args },
                ],
              }
            : prev,
        );
      } else if (type === 'tool_result' && payload && typeof payload === 'object') {
        const p = payload as {
          tool_use_id: string;
          name: string;
          ok: boolean;
          summary: string;
          invalidatesBoard: boolean;
        };
        if (p.invalidatesBoard) stateDirty = true;
        setLive((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            traces: prev.traces.map((t) =>
              t.tool_use_id === p.tool_use_id
                ? { ...t, result: { ok: p.ok, summary: p.summary } }
                : t,
            ),
          };
        });
        if (p.invalidatesBoard) router.refresh();
      } else if (type === 'error' && payload && typeof payload === 'object') {
        const { message } = payload as { message: string };
        setError(message);
      }
    }
  }, [composer, scopeDate, router]);

  if (status && !status.apiKeyPresent) {
    return (
      <aside className="flex h-full flex-col border border-rule bg-paper">
        <header className="border-b border-rule px-4 py-3">
          <div className="font-sans text-[10px] font-semibold uppercase tracking-[0.18em] text-oxblood">
            Curation agent
          </div>
        </header>
        <div className="flex-1 space-y-3 p-4">
          <p className="font-[var(--font-serif-display)] text-xl italic leading-snug text-ink-soft">
            Connect an Anthropic API key to enable the curation agent.
          </p>
          <p className="font-sans text-xs text-ink-soft/80">
            Set <code className="bg-rule/60 px-1">ANTHROPIC_API_KEY</code> in{' '}
            <code className="bg-rule/60 px-1">.env</code> and restart the dev
            server. See RUNBOOK → Curation agent.
          </p>
        </div>
      </aside>
    );
  }

  const empty = turns.length === 0 && !live;

  return (
    <aside className="flex h-full flex-col border border-rule bg-paper">
      <header className="flex items-baseline justify-between gap-3 border-b border-rule px-4 py-3">
        <div className="font-sans text-[10px] font-semibold uppercase tracking-[0.18em] text-oxblood">
          Curation agent
        </div>
        {status && (
          <div className="font-sans text-[10px] italic text-ink-soft">
            {status.model} · {scopeDate}
          </div>
        )}
      </header>
      {error && (
        <AgentErrorBanner
          message={error}
          onDismiss={() => setError(null)}
        />
      )}
      <div
        ref={scrollRef}
        className="flex-1 space-y-4 overflow-y-auto px-4 py-4"
      >
        {empty && (
          <p className="font-[var(--font-serif-display)] text-lg italic leading-snug text-ink-soft">
            Ask for picks — by feeling, by cluster, by channel. Try
            &ldquo;three things that lean rigor-over-rhetoric.&rdquo;
          </p>
        )}
        {turns.map((t, i) => {
          if (t.role === 'tool') return null;
          let traces: ToolTrace[] | undefined;
          if (t.role === 'assistant') {
            traces = collectTracesFor(t, turns.slice(i + 1));
          }
          return (
            <Message
              key={t.id}
              role={t.role}
              blocks={t.blocks}
              traces={traces}
            />
          );
        })}
        {live && (
          <Message
            role="assistant"
            blocks={live.text ? [{ type: 'text', text: live.text }] : []}
            traces={live.traces}
          />
        )}
      </div>
      <Composer
        value={composer}
        onChange={setComposer}
        onSubmit={onSubmit}
        disabled={phase === 'streaming'}
      />
      {status &&
        status.apiKeyPresent &&
        !status.youtubeSearchEnabled && (
          <div className="border-t border-rule px-4 py-2 font-sans text-[11px] italic text-ink-soft">
            Active YouTube search is disabled. Set{' '}
            <a
              href="/settings/discovery"
              title="See RUNBOOK → Discovery (active) for setup."
              className="underline hover:text-ink"
            >
              <code className="not-italic">YOUTUBE_API_KEY</code>
            </a>{' '}
            to enable.
          </div>
        )}
    </aside>
  );
}

function collectTracesFor(
  assistant: RenderedTurn,
  following: RenderedTurn[],
): ToolTrace[] {
  const uses = assistant.blocks.filter(
    (b): b is Extract<TurnContentBlock, { type: 'tool_use' }> =>
      b.type === 'tool_use',
  );
  if (uses.length === 0) return [];
  const nextTool = following.find((t) => t.role === 'tool');
  const results = new Map<
    string,
    Extract<TurnContentBlock, { type: 'tool_result' }>
  >();
  if (nextTool) {
    for (const b of nextTool.blocks) {
      if (b.type === 'tool_result') results.set(b.tool_use_id, b);
    }
  }
  return uses.map((u) => {
    const r = results.get(u.id);
    let summary = `${u.name} ran`;
    let ok = true;
    if (r) {
      try {
        const parsed = JSON.parse(r.content) as Record<string, unknown>;
        if (r.is_error) {
          ok = false;
          const err = parsed['error'];
          summary = `${u.name} → ${typeof err === 'string' ? err : 'error'}`;
        } else {
          const count = parsed['count'];
          if (typeof count === 'number') {
            summary = `${u.name} — ${count} hit${count === 1 ? '' : 's'}`;
          }
        }
      } catch {
        /* ignore */
      }
    }
    return {
      tool_use_id: u.id,
      name: u.name,
      args: u.input,
      result: { ok, summary },
    };
  });
}
