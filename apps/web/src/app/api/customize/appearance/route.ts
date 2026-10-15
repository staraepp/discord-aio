import { z } from 'zod';
import { adminRoute, audit, awaitCommand, command, HttpError, readJson } from '@/lib/api';

/** Images arrive resized in the browser; this caps what reaches Discord. */
const image = z
  .string()
  .max(480_000, 'That image is too large, try a smaller one.')
  .regex(/^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$/, 'Use a PNG, JPEG, GIF or WebP image.')
  .nullable()
  .optional();

const schema = z.object({ avatar: image, banner: image, bio: z.string().max(190).nullable().optional() }).refine((v) => v.avatar !== undefined || v.banner !== undefined || v.bio !== undefined, 'Nothing to change.');

/** Server-only avatar/banner/bio for the bot. `null` resets to its normal profile. */
export const POST = adminRoute(async ({ req, session }) => {
  const input = await readJson(req, schema);
  const id = await command(session, 'profile.apply', input);
  await audit(session, { module: 'core', action: 'profile.appearance', meta: { avatar: input.avatar === undefined ? 'unchanged' : input.avatar ? 'set' : 'reset', banner: input.banner === undefined ? 'unchanged' : input.banner ? 'set' : 'reset', bio: input.bio === undefined ? 'unchanged' : 'set' } });
  const done = await awaitCommand(id, 10_000);
  if (!done) return { status: 'queued', message: 'The bot will apply this when it is online.' };
  if (done.status === 'failed') throw new HttpError(502, done.error ?? 'Discord rejected the change.');
  return { status: 'done', message: 'Updated. Discord may take a minute to show it everywhere.' };
});
