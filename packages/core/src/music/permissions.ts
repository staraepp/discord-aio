/**
 * Music ownership rules shared by slash commands, panel components and the
 * dashboard. There is no DJ role and no vote-skip.
 *
 * - Staff (music staff bypass) can control everything.
 * - A temp-room owner controls their own room's session like staff.
 * - Ordinary members: skip only their own playing track; remove/move only their
 *   own pending tracks; pause/resume/seek/previous only while their own track
 *   is playing. Loop/shuffle/volume/stop/clear-all/jump/disconnect need staff.
 */

export type MusicAction =
  | 'play'
  | 'skip'
  | 'previous'
  | 'pause'
  | 'resume'
  | 'seek'
  | 'stop'
  | 'loop'
  | 'shuffle'
  | 'volume'
  | 'filter'
  | 'remove'
  | 'move'
  | 'clear_mine'
  | 'clear_all'
  | 'jump'
  | 'forceplay'
  | 'forceskip'
  | 'disconnect'
  | 'toggle_247';

export interface MusicActor {
  userId: string;
  isStaff: boolean;
  /** Owner of the temp room this session belongs to. */
  isRoomOwner?: boolean;
  /** Actor is in the session's voice channel (dashboard staff are exempt). */
  inVoiceChannel: boolean;
  viaDashboard?: boolean;
}

export type MusicDecision = { ok: true } | { ok: false; reason: string };

const STAFF_ONLY: MusicAction[] = ['stop', 'loop', 'shuffle', 'volume', 'filter', 'clear_all', 'jump', 'forceplay', 'forceskip', 'disconnect', 'toggle_247'];
const OWN_CURRENT: MusicAction[] = ['skip', 'pause', 'resume', 'seek', 'previous'];

export function authorizeMusicAction(params: {
  action: MusicAction;
  actor: MusicActor;
  /** Requester of the currently playing track, if any. */
  currentRequesterId?: string;
  /** Requester of the targeted pending entry (remove/move). */
  targetRequesterId?: string;
}): MusicDecision {
  const { action, actor } = params;
  const elevated = actor.isStaff || actor.isRoomOwner === true;
  if (!actor.viaDashboard && !actor.inVoiceChannel && action !== 'clear_mine') {
    return { ok: false, reason: 'Join the voice channel this player is in to control it.' };
  }
  if (actor.viaDashboard && !actor.isStaff) return { ok: false, reason: 'Dashboard music controls are staff-only.' };
  if (elevated) return { ok: true };
  if (action === 'play' || action === 'clear_mine') return { ok: true };
  if (STAFF_ONLY.includes(action)) return { ok: false, reason: 'Only staff can do that.' };
  if (OWN_CURRENT.includes(action)) {
    if (!params.currentRequesterId) return { ok: false, reason: 'Nothing is playing right now.' };
    return params.currentRequesterId === actor.userId
      ? { ok: true }
      : { ok: false, reason: action === 'skip' ? 'You can only skip songs you requested.' : 'You can only control playback while your own song is playing.' };
  }
  if (action === 'remove' || action === 'move') {
    return params.targetRequesterId === actor.userId ? { ok: true } : { ok: false, reason: 'You can only change tracks you requested.' };
  }
  return { ok: false, reason: 'Not allowed.' };
}
