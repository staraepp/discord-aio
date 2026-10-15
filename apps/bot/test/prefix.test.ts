import { describe, expect, it, vi } from 'vitest';
import { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { commandSettingsSchema } from '@aio/core/customize';
import { hasDefaultPermissions, matchPrefix, runPrefixCommand } from '../src/runtime/prefix';
import type { SlashCommand } from '../src/commands/types';

const ALICE = '111111111111111111';

function fakeMessage(content: string) {
  const replies: unknown[] = [];
  const alice = { id: ALICE, displayName: 'Alice', user: { id: ALICE, username: 'alice', globalName: 'Alice' } };
  const channel = { id: '5'.repeat(18), send: vi.fn(async (o: unknown) => (replies.push(o), { delete: vi.fn(async () => undefined) })), sendTyping: vi.fn(async () => undefined) };
  const guild = {
    id: '9'.repeat(18),
    members: { cache: new Map([[ALICE, alice]]), fetch: vi.fn(async () => alice) },
    channels: { cache: new Map() },
    roles: { cache: new Map() },
  };
  const message = {
    id: '7'.repeat(18),
    content,
    guild,
    guildId: guild.id,
    channel,
    channelId: channel.id,
    author: { id: '2'.repeat(18), send: vi.fn(async () => null) },
    member: { id: '2'.repeat(18) },
    client: { users: { fetch: vi.fn(async () => null) } },
    createdTimestamp: 0,
    reply: vi.fn(async (o: unknown) => (replies.push(o), { delete: vi.fn(async () => undefined), edit: vi.fn(async () => undefined) })),
    delete: vi.fn(async () => undefined),
  };
  return { message, replies };
}

const warn: SlashCommand = {
  module: 'moderation',
  data: new SlashCommandBuilder()
    .setName('warn')
    .setDescription('Warn')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption((o) => o.setName('member').setDescription('m').setRequired(true))
    .addStringOption((o) => o.setName('reason').setDescription('r').setRequired(true))
    .toJSON(),
  async execute(i) {
    const member = i.options.getMember('member');
    return i.reply({ content: `warned ${member?.displayName} for ${i.options.getString('reason', true)}` });
  },
};

describe('prefix commands', () => {
  const settings = commandSettingsSchema.parse({ commands: { warn: { aliases: ['w'] } } });
  const commands = new Map([['warn', warn]]);

  it('matches names and aliases, ignores other text', () => {
    expect(matchPrefix('+warn @a hi', '+', commands, settings)?.name).toBe('warn');
    expect(matchPrefix('+W @a hi', '+', commands, settings)?.args).toBe('@a hi');
    expect(matchPrefix('+1 agreed', '+', commands, settings)).toBeNull();
    expect(matchPrefix('warn', '+', commands, settings)).toBeNull();
  });

  it('checks the permissions Discord would enforce for slash', () => {
    const can = { permissions: { has: (p: bigint) => p === PermissionFlagsBits.ModerateMembers } };
    const cannot = { permissions: { has: () => false } };
    expect(hasDefaultPermissions(warn, can as never)).toBe(true);
    expect(hasDefaultPermissions(warn, cannot as never)).toBe(false);
  });

  it('runs the unchanged slash handler with parsed options', async () => {
    const { message, replies } = fakeMessage(`+warn <@${ALICE}> being bad`);
    const r = await runPrefixCommand({} as never, message as never, { cmd: warn, name: 'warn', args: `<@${ALICE}> being bad` }, '+', false);
    expect(r).toEqual({ ok: true });
    expect(replies).toHaveLength(1);
    expect(replies[0]).toMatchObject({ content: 'warned Alice for being bad', allowedMentions: { repliedUser: false } });
  });

  it('returns usage instead of running when arguments are wrong', async () => {
    const { message, replies } = fakeMessage('+warn nobody');
    const r = await runPrefixCommand({} as never, message as never, { cmd: warn, name: 'warn', args: 'nobody' }, '+', false);
    expect(r).toMatchObject({ ok: false, usage: '+warn <member> <reason…>' });
    expect(replies).toHaveLength(0);
  });

  it('staff-only private replies go to DMs, with a channel fallback that deletes itself', async () => {
    const privateWarn: SlashCommand = { ...warn, execute: async (i) => i.reply({ content: 'secret', flags: MessageFlags.Ephemeral }) };
    const { message, replies } = fakeMessage('');
    await runPrefixCommand({} as never, message as never, { cmd: privateWarn, name: 'warn', args: `<@${ALICE}> x` }, '+', false);
    expect(message.author.send).toHaveBeenCalled();
    // DMs closed (send returned null) → falls back to a channel reply.
    expect(replies[0]).toMatchObject({ content: 'secret' });
    expect((replies[0] as { flags?: number }).flags).toBeUndefined();
  });
});
