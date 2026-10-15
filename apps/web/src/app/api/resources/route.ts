import { adminRoute, HttpError } from '@/lib/api';
import { DiscordUnavailableError, getResources, invalidateGuildCache } from '@/lib/discord';

export const GET = adminRoute(async ({ req }) => {
  if (req.nextUrl.searchParams.get('refresh') === '1') invalidateGuildCache();
  try {
    return await getResources();
  } catch (err) {
    if (err instanceof DiscordUnavailableError) throw new HttpError(503, `Discord data is unavailable: ${err.message}`);
    throw err;
  }
});
