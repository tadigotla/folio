import type { ZodError } from 'zod';
import { IllegalTransitionError } from '../consumption';
import {
  PlaylistNotFoundError,
  VideoNotFoundError,
  DuplicateVideoInPlaylistError,
  InvalidPositionError,
} from '../playlists';
import { ClusterNotFoundError } from '../mutes';
import { IllegalEditError, ConcurrentEditError } from '../taste-edit';

export type ToolErrorCode =
  | 'validation'
  | 'not_found'
  | 'conflict'
  | 'precondition_failed'
  | 'permission_denied'
  | 'upstream_unavailable'
  | 'internal';

export interface ToolError {
  code: ToolErrorCode;
  message: string;
  details?: unknown;
}

export type ToolResult =
  | { ok: true; result: unknown }
  | { ok: false; error: ToolError };

export function ok(result: unknown): ToolResult {
  return { ok: true, result };
}

export function err(
  code: ToolErrorCode,
  message: string,
  details?: unknown,
): ToolResult {
  return {
    ok: false,
    error: details === undefined ? { code, message } : { code, message, details },
  };
}

export function mapToolError(error: unknown): ToolResult {
  if (error instanceof IllegalTransitionError) return err('conflict', error.message);
  if (error instanceof PlaylistNotFoundError) return err('not_found', error.message);
  if (error instanceof VideoNotFoundError) return err('not_found', error.message);
  if (error instanceof ClusterNotFoundError) return err('not_found', error.message);
  if (error instanceof DuplicateVideoInPlaylistError) return err('conflict', error.message);
  if (error instanceof InvalidPositionError) return err('validation', error.message);
  if (error instanceof IllegalEditError) return err('conflict', error.message);
  if (error instanceof ConcurrentEditError) return err('conflict', error.message);
  console.error('[agent.tool] uncaught error in tool execution:', error);
  return err('internal', 'tool execution failed');
}

export function fromZodError(error: ZodError): ToolResult {
  return err(
    'validation',
    error.issues
      .map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`)
      .join('; '),
    error.issues,
  );
}
