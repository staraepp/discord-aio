import { z } from 'zod';
import { totalXpForLevel, xpToNext } from '@aio/core/leveling';
import { adminRoute, readJson } from '@/lib/api';

/** Level curve preview for the settings page. */
export const POST = adminRoute(async ({ req }) => {
  const { formula, difficulty } = await readJson(req, z.object({ formula: z.enum(['linear', 'quadratic', 'exponential']), difficulty: z.number().min(0.25).max(5) }));
  return [1, 5, 10, 20, 30, 50, 75, 100].map((level) => ({ level, total: totalXpForLevel(level, formula, difficulty), next: xpToNext(level, formula, difficulty) }));
});
