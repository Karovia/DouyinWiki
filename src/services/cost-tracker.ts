import { eq, and, gte, lte } from 'drizzle-orm';
import { db } from '~/db';
import { usageLogs } from '~/db/schema';
import { nanoid } from 'nanoid';

const COST_PER_1K_TOKENS: Record<string, { input: number; output: number }> = {
  llm: { input: 0.0015, output: 0.002 },
  embedding: { input: 0.0001, output: 0 },
  asr: { input: 0.006, output: 0 },
};

export class CostTracker {
  async trackUsage(params: {
    workspaceId: string;
    resourceType: 'llm' | 'embedding' | 'asr';
    operation: string;
    inputTokens?: number;
    outputTokens?: number;
    durationMinutes?: number;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    const pricing = COST_PER_1K_TOKENS[params.resourceType];
    let estimatedCost = 0;

    if (params.resourceType === 'asr' && params.durationMinutes) {
      estimatedCost = params.durationMinutes * pricing.input;
    } else {
      const inputCost = ((params.inputTokens || 0) / 1000) * pricing.input;
      const outputCost = ((params.outputTokens || 0) / 1000) * pricing.output;
      estimatedCost = inputCost + outputCost;
    }

    await db.insert(usageLogs).values({
      id: nanoid(),
      workspaceId: params.workspaceId,
      resourceType: params.resourceType,
      operation: params.operation,
      inputTokens: params.inputTokens,
      outputTokens: params.outputTokens,
      estimatedCost: Math.round(estimatedCost * 1000000) / 1000000,
      metadata: params.metadata ? JSON.stringify(params.metadata) : null,
    });
  }

  async getWorkspaceCostSummary(workspaceId: string, startDate?: Date, endDate?: Date): Promise<{
    totalCost: number;
    llmCost: number;
    embeddingCost: number;
    asrCost: number;
    totalCalls: number;
  }> {
    let conditions = [eq(usageLogs.workspaceId, workspaceId)];
    if (startDate) conditions.push(gte(usageLogs.createdAt, startDate));
    if (endDate) conditions.push(lte(usageLogs.createdAt, endDate));

    const rows = await db.select().from(usageLogs).where(and(...conditions));

    let totalCost = 0, llmCost = 0, embeddingCost = 0, asrCost = 0;
    for (const row of rows) {
      totalCost += row.estimatedCost || 0;
      if (row.resourceType === 'llm') llmCost += row.estimatedCost || 0;
      if (row.resourceType === 'embedding') embeddingCost += row.estimatedCost || 0;
      if (row.resourceType === 'asr') asrCost += row.estimatedCost || 0;
    }

    return {
      totalCost: Math.round(totalCost * 1000) / 1000,
      llmCost: Math.round(llmCost * 1000) / 1000,
      embeddingCost: Math.round(embeddingCost * 1000) / 1000,
      asrCost: Math.round(asrCost * 1000) / 1000,
      totalCalls: rows.length,
    };
  }
}
