import { describe, expect, it, vi } from 'vitest';
import { PermissionFlagsBits } from 'discord.js';
import { suggestionSettingsSchema } from '@aio/core/settings';
import { suggestionsModule } from '../src/modules/suggestions/index';
import { runPrefixCommand } from '../src/runtime/prefix';

const BOT = '1'.repeat(18);
const MEMBER = '2'.repeat(18);
let nextChannel = 300000000000000000n;
/** The webhook cache is per channel, so every test posts to a channel of its own. */
const freshChannelId = () => String(nextChannel++);
const GENERAL = '4'.repeat(18);

const suggest = suggestionsModule.commands!.find((c) => c.data.name === 'suggest')!;

function fakePosted() {
  return { id: '8'.repeat(18), react: vi.fn(async () => undefined) };
}

function fakeChannel(id: string, opts: { webhooks?: boolean } = {}) {
  const posted = fakePosted();
  const hookPosted = fakePosted();
  const webhook = { applicationId: BOT, token: 'hook-token', send: vi.fn(async () => hookPosted) };
  return {
    id,
    posted,
    hookPosted,
    webhook,
    isTextBased: () => true,
    isDMBased: () => false,
    isThread: () => false,
    permissionsFor: () => ({
      has: (p: bigint) => p !== PermissionFlagsBits.ManageWebhooks || (opts.webhooks ?? true),
    }),
    send: vi.fn(async () => posted),
    sendTyping: vi.fn(async () => undefined),
    fetchWebhooks: vi.fn(async () => ({ find: () => undefined })),
    createWebhook: vi.fn(async () => webhook),
  };
}

function fakeGuild(...channels: ReturnType<typeof fakeChannel>[]) {
  const guild = {
    id: '9'.repeat(18),
    members: { me: { id: BOT }, cache: new Map(), fetch: vi.fn(async () => null) },
    channels: { cache: new Map(channels.map((c) => [c.id, c])) },
    roles: { cache: new Map() },
  };
  for (const c of channels) Object.assign(c, { guild });
  return guild;
}

function fakeMember() {
  return { id: MEMBER, displayName: 'yunijnz', displayAvatarURL: () => 'https://cdn.example/avatar.png' };
}

function fakeCtx(settings: Record<string, unknown>) {
  return {
    module: async () => ({ enabled: true, settings: suggestionSettingsSchema.parse(settings) }),
    replyColor: async (fallback: number) => fallback,
    audit: vi.fn(async () => undefined),
  };
}

function fakeInteraction(guild: ReturnType<typeof fakeGuild>, text: string) {
  return {
    id: '6'.repeat(18),
    user: { id: MEMBER },
    member: fakeMember(),
    guild,
    options: { getString: () => text },
    reply: vi.fn(async () => undefined),
    deferReply: vi.fn(async () => undefined),
    editReply: vi.fn(async () => undefined),
  };
}

describe('suggestions', () => {
  it('posts as the member through a webhook, adds the vote reactions in order and confirms privately', async () => {
    const SUGGESTIONS = freshChannelId();
    const channel = fakeChannel(SUGGESTIONS);
    const i = fakeInteraction(fakeGuild(channel), '  phone shaders  ');
    const ctx = fakeCtx({ channelId: SUGGESTIONS, cooldownSeconds: 0 });
    await suggest.execute(i as never, ctx as never);

    expect(channel.webhook.send).toHaveBeenCalledWith(
      expect.objectContaining({
        username: 'yunijnz',
        avatarURL: 'https://cdn.example/avatar.png',
        allowedMentions: { parse: [] },
        embeds: [
          expect.objectContaining({ description: 'phone shaders', footer: { text: `User ID: ${MEMBER}` } }),
        ],
      }),
    );
    expect(channel.send).not.toHaveBeenCalled();
    expect(channel.hookPosted.react.mock.calls.map((c: unknown[]) => c[0])).toEqual(['✅', '➖', '❌']);
    expect(i.editReply).toHaveBeenCalledWith({
      content: `Thanks! Your suggestion is up in <#${SUGGESTIONS}>.`,
    });
    expect(ctx.audit).toHaveBeenCalledWith(
      expect.objectContaining({ actorId: MEMBER, action: 'suggestion.post' }),
    );
  });

  it('posts as the bot with the member on top when webhooks are not allowed', async () => {
    const SUGGESTIONS = freshChannelId();
    const channel = fakeChannel(SUGGESTIONS, { webhooks: false });
    const i = fakeInteraction(fakeGuild(channel), 'mac intel shaders');
    await suggest.execute(i as never, fakeCtx({ channelId: SUGGESTIONS, cooldownSeconds: 0 }) as never);

    expect(channel.createWebhook).not.toHaveBeenCalled();
    expect(channel.send).toHaveBeenCalledWith({
      embeds: [
        expect.objectContaining({
          author: { name: 'yunijnz', icon_url: 'https://cdn.example/avatar.png' },
          description: 'mac intel shaders',
        }),
      ],
      allowedMentions: { parse: [] },
    });
    expect(channel.posted.react).toHaveBeenCalledTimes(3);
  });

  it('asks staff to set it up when no channel is chosen', async () => {
    const i = fakeInteraction(fakeGuild(), 'idea');
    await suggest.execute(i as never, fakeCtx({}) as never);

    expect(i.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringMatching(/set up yet/) }),
    );
    expect(i.deferReply).not.toHaveBeenCalled();
  });

  it('makes a member wait between suggestions', async () => {
    const SUGGESTIONS = freshChannelId();
    const channel = fakeChannel(SUGGESTIONS, { webhooks: false });
    const guild = fakeGuild(channel);
    const ctx = fakeCtx({ channelId: SUGGESTIONS, cooldownSeconds: 60 });
    await suggest.execute(fakeInteraction(guild, 'first') as never, ctx as never);
    const second = fakeInteraction(guild, 'second');
    await suggest.execute(second as never, ctx as never);

    expect(channel.send).toHaveBeenCalledTimes(1);
    expect(second.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringMatching(/another in \d+s/) }),
    );
  });

  it('+suggest deletes the trigger and posts the whole text', async () => {
    const SUGGESTIONS = freshChannelId();
    const target = fakeChannel(SUGGESTIONS, { webhooks: false });
    const here = fakeChannel(GENERAL);
    const guild = fakeGuild(target, here);
    const message = {
      id: '7'.repeat(18),
      content: '',
      guild,
      guildId: guild.id,
      channel: here,
      channelId: here.id,
      author: { id: MEMBER + '1', send: vi.fn(async () => null) },
      member: { ...fakeMember(), id: MEMBER + '1' },
      client: { users: { fetch: vi.fn(async () => null) } },
      createdTimestamp: 0,
      reply: vi.fn(async () => ({ delete: vi.fn(async () => undefined) })),
      delete: vi.fn(async () => undefined),
    };
    await runPrefixCommand(
      fakeCtx({ channelId: SUGGESTIONS, cooldownSeconds: 0 }) as never,
      message as never,
      { cmd: suggest, name: 'suggest', args: 'try to add it for windows users too' },
      '+',
      false,
    );

    expect(message.delete).toHaveBeenCalled();
    expect(target.send).toHaveBeenCalledWith(
      expect.objectContaining({
        embeds: [expect.objectContaining({ description: 'try to add it for windows users too' })],
      }),
    );
    // The trigger is gone, so the private confirmation is a short-lived channel message, not a reply or a DM.
    expect(message.reply).not.toHaveBeenCalled();
    expect(message.author.send).not.toHaveBeenCalled();
    expect(here.send).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringMatching(/Thanks!/) }),
    );
  });
});
