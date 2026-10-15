import { escapeMd, sourceLabel, truncate, type AddedSummary } from '@aio/core/music';
import { formatDuration } from '@aio/discord-ui';
import type { CardInput } from '../../runtime/cards.js';

/** "~6:42", or a reason when the wait can't be known. */
export function waitLabel(added: AddedSummary): string {
  const spot = added.spot;
  if (!spot) return 'Soon';
  if (spot.etaMs === null) return 'After the songs ahead of it';
  if (spot.etaMs < 5_000) return 'Next up';
  return `~${formatDuration(spot.etaMs)}`;
}

/** The reply to `/play`: what was added, where it sits and roughly when it plays. */
export function addedCard(added: AddedSummary): CardInput {
  const playingNow = added.spot?.playingNow ?? false;
  const length = added.isStream ? 'LIVE' : formatDuration(added.durationMs);
  const line = `by **${escapeMd(truncate(added.author, 60))}** · ${length} · ${sourceLabel(added.sourceName)}`;
  const collection = added.collectionName && added.count > 1;
  const fields =
    playingNow || !added.spot
      ? []
      : [
          { name: 'Place in line', value: `#${added.spot.place}`, inline: true },
          { name: 'Plays in', value: waitLabel(added), inline: true },
        ];
  return {
    eyebrow: playingNow ? 'Playing now' : 'Added to the queue',
    title: collection ? `${added.count} tracks from ${truncate(added.collectionName!, 200)}` : truncate(added.title, 250),
    url: collection ? null : added.uri,
    body: collection ? `Starting with **${escapeMd(truncate(added.title, 100))}** ${line}` : line,
    fields,
    thumbnail: added.artworkUrl,
    notes: added.notes,
  };
}
