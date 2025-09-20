/**
 * SafeSpot Sentinel Global V2 - AI Moderation Service
 * Uses Emergent LLM universal key (env: EMERGENT_LLM_KEY or EMERGENT_LLM_API_KEY)
 * Fetch-based implementation with timeout, retries, and graceful fallback
 */

import { logger } from '../utils/logger.js';

export interface ModerationInput {
  title: string;
  description: string;
  metadata?: Record<string, any>;
}

export interface ModerationResult {
  isAppropriate: boolean;
  trustScore: number; // 0-100
  categories: string[];
  reason: string;
  timestamp: string;
  version: string;
}

const DEFAULT_ENDPOINT = 'https://api.emergentllm.com/v1/moderate';

function getKey(): string | undefined {
  return process.env.EMERGENT_LLM_KEY || process.env.EMERGENT_LLM_API_KEY;
}

function getEndpoint(): string {
  return process.env.EMERGENT_LLM_BASE_URL
    ? `${process.env.EMERGENT_LLM_BASE_URL.replace(/\/$/, '')}/moderate`
    : DEFAULT_ENDPOINT;
}

function isRetryable(e: any): boolean {
  if (!e) return false;
  const msg = String(e.message || '');
  if (e.name === 'AbortError') return false;
  if (msg.includes('HTTP 4')) return false; // 4xx is not retryable
  return true; // network/5xx
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function moderateContent(
  input: ModerationInput,
  opts?: { timeoutMs?: number; maxRetries?: number; retryDelayMs?: number; fallback?: boolean }
): Promise<ModerationResult> {
  const timeoutMs = opts?.timeoutMs ?? 25000;
  const maxRetries = opts?.maxRetries ?? 2;
  const retryDelayMs = opts?.retryDelayMs ?? 800;
  const key = getKey();
  const endpoint = getEndpoint();

  const controller = new AbortController();
  const to = setTimeout(() => controller.abort(), timeoutMs);

  const body = {
    content: {
      title: (input.title || '').toString(),
      description: (input.description || '').toString(),
    },
    metadata: input.metadata || {},
  };

  let attempt = 0;
  try {
    while (true) {
      attempt++;
      try {
        if (!key) throw new Error('EMERGENT_LLM_KEY missing');

        const res = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${key}`,
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        if (!res.ok) {
          throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        }
        const data = await res.json();

        // Map generic response to our schema
        const flagged = Boolean(data.flagged);
        const risk = typeof data.risk_score === 'number' ? data.risk_score : 0.5; // 0..1
        const trust = Math.max(0, Math.min(100, Math.round((1 - risk) * 100)));

        return {
          isAppropriate: !flagged,
          trustScore: trust,
          categories: Array.isArray(data.categories) ? data.categories : [],
          reason: data.explanation || data.reason || 'Content analysis completed',
          timestamp: new Date().toISOString(),
          version: 'moderation-1.0.0',
        };
      } catch (err: any) {
        if (attempt > maxRetries || !isRetryable(err)) {
          if (opts?.fallback) {
            logger.warn({ err }, 'Moderation failed, using fallback');
            return {
              isAppropriate: false,
              trustScore: 25,
              categories: ['requires_manual_review'],
              reason: 'Fallback: moderation unavailable',
              timestamp: new Date().toISOString(),
              version: 'moderation-fallback-1.0',
            };
          }
          throw err;
        }
        await sleep(retryDelayMs * Math.pow(2, attempt - 1));
      }
    }
  } finally {
    clearTimeout(to);
  }
}