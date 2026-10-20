import { describe, expect, it, vi } from 'vitest';
import { moderationModule } from '../src/modules/moderation/index';
import { runPrefixCommand } from '../src/runtime/prefix';

const STAFF = '2'.repeat(18);
const CHANNEL = '5'.repeat(18);
const TRIGGER = '7'.repeat(18);

const echo = moderationModule.commands!.find((c) => c.data.name === 'echo')!;

function fakeCtx(isStaff: boolean) {
  return { isAdmin: () => false, isStaff: async () => isStaff, audit: vi.fn(async () => undefined) };
}

function fakeChannel() {
  return {
    id: CHANNEL,
    permissionsFor: () => ({ has: () => true }),
    send: vi.fn(async () => ({ id: '8'.repeat(18), delete: vi.fn(async () => undefined) })),
    sendTyping: vi.fn(async () => undefined),
  };
}

function fakeGuild() {
  return {
    id: '9'.repeat(18),
    members: { me: {}, cache: new Map(), fetch: vi.fn(async () => null) },
    channels: { cache: new Map() },
    roles: { cache: new Map() },
  };
}

function fakeMessage(channel: ReturnType<typeof fakeChannel>) {
  const guild = fakeGuild();
  return {
    id: TRIGGER,
    content: '',
    guild,
    guildId: guild.id,
    channel,
    channelId: channel.id,
    author: { id: STAFF, send: vi.fn(async () => null) },
    member: { id: STAFF },
    client: { users: { fetch: vi.fn(async () => null) } },
    createdTimestamp: 0,
    reply: vi.fn(async () => ({ delete: vi.fn(async () => undefined) })),
    delete: vi.fn(async () => undefined),
  };
}

describe('echo', () => {
  it('+echo posts the whole message without pings and deletes the trigger', async () => {
    const channel = fakeChannel();
    const message = fakeMessage(channel);
    const ctx = fakeCtx(true);
    const r = await runPrefixCommand(
      ctx as never,
      message as never,
      { cmd: echo, name: 'echo', args: 'hello @everyone there' },
      '+',
      false,
    );

    expect(r).toEqual({ ok: true });
    expect(message.delete).toHaveBeenCalled();
    expect(channel.send).toHaveBeenCalledWith({
      content: 'hello @everyone there',
      allowedMentions: { parse: [] },
    });
    expect(message.reply).not.toHaveBeenCalled();
    expect(message.author.send).not.toHaveBeenCalled();
    expect(ctx.audit).toHaveBeenCalledWith(expect.objectContaining({ actorId: STAFF, action: 'echo.send' }));
  });

  it('+echo from a non-staff member posts nothing', async () => {
    const channel = fakeChannel();
    const message = fakeMessage(channel);
    await runPrefixCommand(
      fakeCtx(false) as never,
      message as never,
      { cmd: echo, name: 'echo', args: 'hi' },
      '+',
      false,
    );

    expect(channel.send).not.toHaveBeenCalledWith(expect.objectContaining({ content: 'hi' }));
  });

  it('/echo posts the message and removes its own acknowledgement', async () => {
    const channel = fakeChannel();
    const interaction = {
      id: '6'.repeat(18),
      user: { id: STAFF },
      member: { id: STAFF },
      guild: fakeGuild(),
      channel,
      options: { getString: () => 'hello' },
      reply: vi.fn(async () => undefined),
      deferReply: vi.fn(async () => undefined),
      deleteReply: vi.fn(async () => undefined),
    };
    await echo.execute(interaction as never, fakeCtx(true) as never);

    expect(interaction.deferReply).toHaveBeenCalled();
    expect(channel.send).toHaveBeenCalledWith({ content: 'hello', allowedMentions: { parse: [] } });
    expect(interaction.deleteReply).toHaveBeenCalled();
    expect(interaction.reply).not.toHaveBeenCalled();
  });
});
