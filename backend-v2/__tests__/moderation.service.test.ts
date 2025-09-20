import { moderateContent } from '../src/services/moderation.js';

describe('Moderation Service', () => {
  beforeEach(() => {
    (global as any).fetch = jest.fn();
  });

  it('returns appropriate when API flags false', async () => {
    (fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ flagged: false, risk_score: 0.1, categories: ['safe'], explanation: 'ok' }),
    });

    process.env.EMERGENT_LLM_KEY = 'test-key';
    const res = await moderateContent({ title: 'Hello', description: 'World' });
    expect(res.isAppropriate).toBe(true);
    expect(res.trustScore).toBe(90);
    expect(res.categories).toEqual(['safe']);
  });

  it('returns FLAGGED-style response when API flags true', async () => {
    (fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ flagged: true, risk_score: 0.9, categories: ['harassment'], explanation: 'bad' }),
    });

    process.env.EMERGENT_LLM_KEY = 'test-key';
    const res = await moderateContent({ title: 'A', description: 'B' });
    expect(res.isAppropriate).toBe(false);
    expect(res.trustScore).toBe(10);
    expect(res.categories).toEqual(['harassment']);
  });

  it('uses fallback on error when enabled', async () => {
    (fetch as any).mockRejectedValueOnce(new Error('Service down'));
    delete process.env.EMERGENT_LLM_KEY; // ensure key missing also triggers fallback path

    const res = await moderateContent({ title: 'X', description: 'Y' }, { fallback: true });
    expect(res.isAppropriate).toBe(false);
    expect(res.categories).toContain('requires_manual_review');
  });
});