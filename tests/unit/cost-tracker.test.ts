import { describe, it, expect, beforeEach } from 'vitest';
import { CostTracker } from '~/services/cost-tracker';
import { db } from '~/db';
import { usageLogs } from '~/db/schema';
import { eq } from 'drizzle-orm';

const workspaceId = 'test-ws-cost';

describe('CostTracker', () => {
  beforeEach(async () => {
    await db.delete(usageLogs).where(eq(usageLogs.workspaceId, workspaceId));
  });

  it('tracks LLM usage cost', async () => {
    const tracker = new CostTracker();
    await tracker.trackUsage({
      workspaceId,
      resourceType: 'llm',
      operation: 'summary',
      inputTokens: 2000,
      outputTokens: 500,
    });

    const summary = await tracker.getWorkspaceCostSummary(workspaceId);
    expect(summary.totalCalls).toBe(1);
    expect(summary.llmCost).toBeGreaterThan(0);
    expect(summary.totalCost).toBe(summary.llmCost);
  });

  it('tracks ASR usage cost', async () => {
    const tracker = new CostTracker();
    await tracker.trackUsage({
      workspaceId,
      resourceType: 'asr',
      operation: 'transcribe',
      durationMinutes: 2.5,
    });

    const summary = await tracker.getWorkspaceCostSummary(workspaceId);
    expect(summary.asrCost).toBe(0.015);
  });
});
