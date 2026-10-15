import { adminRoute } from '@/lib/api';
import { db } from '@/lib/server';

export const GET = adminRoute(async ({ guildId }) => db().tempVoiceRoom.findMany({ where: { guildId, deletedAt: null }, orderBy: { createdAt: 'desc' }, take: 100 }));
