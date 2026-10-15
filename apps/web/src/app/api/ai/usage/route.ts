import { monthStart } from '@aio/core/ai';
import { adminRoute } from '@/lib/api';
import { db } from '@/lib/server';
import { budgetState } from '@/lib/ai';

/** LOCAL cost ESTIMATES from the usage ledger. Not provider billing. */
export const GET = adminRoute(async ({ guildId }) => {
  const since = monthStart();
  const [budget, byModel, recent, daily] = await Promise.all([
    budgetState(guildId),
    db().aIUsageLedger.groupBy({ by: ['provider', 'model', 'purpose'], where: { guildId, createdAt: { gte: since } }, _sum: { inputTokens: true, outputTokens: true, estimatedCostUsd: true }, _count: true }),
    db().aIUsageLedger.findMany({ where: { guildId }, orderBy: { createdAt: 'desc' }, take: 30 }),
    db().$queryRaw<{ day: Date; cost: string; calls: bigint }[]>`
      SELECT date_trunc('day', "createdAt") AS day, COALESCE(SUM("estimatedCostUsd"), 0)::text AS cost, COUNT(*) AS calls
      FROM "AIUsageLedger" WHERE "guildId" = ${guildId} AND "createdAt" >= ${since}
      GROUP BY 1 ORDER BY 1`,
  ]);
  const unpricedModels = [...new Set(byModel.filter((m) => !budget.pricing.some((p) => p.model === m.model)).map((m) => m.model))];
  return {
    budget,
    unpricedModels,
    byModel: byModel.map((m) => ({ provider: m.provider, model: m.model, purpose: m.purpose, calls: m._count, inputTokens: m._sum.inputTokens ?? 0, outputTokens: m._sum.outputTokens ?? 0, estimatedCostUsd: Number(m._sum.estimatedCostUsd ?? 0) })),
    daily: daily.map((d) => ({ day: d.day.toISOString().slice(0, 10), estimatedCostUsd: Number(d.cost), calls: Number(d.calls) })),
    recent: recent.map((r) => ({ ...r, estimatedCostUsd: Number(r.estimatedCostUsd) })),
  };
});
