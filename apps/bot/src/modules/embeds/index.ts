import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, ModalBuilder, SlashCommandBuilder, TextInputBuilder, TextInputStyle, type InteractionUpdateOptions } from 'discord.js';
import { runActions } from '@aio/core';
import { deleteEmbedDraft, getEmbedDraft, listEmbedDrafts, loadSavedEmbed, saveEmbedDraft, savedEmbedInputSchema } from '@aio/core/embeds';
import { colorToHex, messageTemplateSchema, parseColor, renderMessageTemplate, type MessageTemplate } from '@aio/discord-ui';
import type { BotContext } from '../../runtime/context.js';
import { ephemeral, textChannel, toMessageOptions } from '../../runtime/discord.js';
import { createActionExecutor, renderSavedEmbed, variableContext } from '../../runtime/actions.js';
import type { BotModule } from '../../commands/types.js';

/**
 * Editor drafts live in PostgreSQL (EmbedDraft) and are saved on every change, so closing the
 * ephemeral editor, a bot restart or a long break never loses work. Resume with
 * `/embed resume` or from the dashboard's Embeds page.
 */
interface Draft {
  id: string;
  embedId?: string;
  name: string;
  template: MessageTemplate;
}

async function loadDraft(ctx: BotContext, userId: string, id: string | undefined): Promise<Draft | 'invalid' | null> {
  if (!id) return null;
  const row = await getEmbedDraft(ctx.db, ctx.guildId, userId, id);
  if (!row) return null;
  const template = messageTemplateSchema.safeParse(row.template);
  // Half-finished dashboard drafts (e.g. a button without a label) can't be shown in Discord.
  if (!template.success || !template.data.embeds.length) return 'invalid';
  return { id: row.id, embedId: row.embedId ?? undefined, name: row.name, template: template.data };
}

async function persistDraft(ctx: BotContext, userId: string, d: Omit<Draft, 'id'> & { id?: string }): Promise<Draft> {
  const existing = d.id ? await getEmbedDraft(ctx.db, ctx.guildId, userId, d.id) : null;
  const { id } = await saveEmbedDraft(ctx.db, ctx.guildId, userId, { embedId: d.embedId ?? null, name: d.name, template: d.template as never, componentActions: (existing?.componentActions ?? {}) as never }, d.id);
  return { ...d, id };
}

async function draftAutocomplete(ctx: BotContext, userId: string, focused: string) {
  const rows = await listEmbedDrafts(ctx.db, ctx.guildId, userId);
  return rows
    .filter((r) => (r.name || 'Untitled').toLowerCase().includes(focused.toLowerCase()))
    .map((r) => ({ name: `${r.name || 'Untitled'} (edited ${ago(r.updatedAt)})`.slice(0, 100), value: r.id }));
}

function ago(d: Date): string {
  const min = Math.round((Date.now() - d.getTime()) / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  if (min < 48 * 60) return `${Math.round(min / 60)}h ago`;
  return `${Math.round(min / 1440)}d ago`;
}

function editorView(ctx: BotContext, d: Draft, member: Parameters<typeof variableContext>[0], note?: string): InteractionUpdateOptions & { flags?: number } {
  const e = d.template.embeds[0]!;
  const preview = renderMessageTemplate(d.template, variableContext(member), { preview: true });
  const b = (id: string, label: string, style = ButtonStyle.Secondary) => new ButtonBuilder().setCustomId(`em:${id}:${d.id}`).setLabel(label).setStyle(style);
  return {
    content: `**Editing embed “${d.name}”**. Preview is below, variables use sample values.${note ? `\n${note}` : ''}\n-# Fields: ${e.fields.length}/25 · Color ${colorToHex(e.color)} · Autosaved. If this disappears, use \`/embed resume\` or finish it on the dashboard.`,
    embeds: preview.embeds as never,
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(b('text', 'Title & text'), b('color', 'Color'), b('author', 'Author'), b('footer', 'Footer'), b('images', 'Images')),
      new ActionRowBuilder<ButtonBuilder>().addComponents(b('field', 'Add field'), b('clearfields', 'Clear fields', ButtonStyle.Danger), b('content', 'Message text'), b('save', 'Save', ButtonStyle.Success), b('cancel', 'Discard', ButtonStyle.Danger)),
    ],
    allowedMentions: { parse: [] },
  };
}

function input(id: string, label: string, value: string | undefined, opts: { long?: boolean; required?: boolean; max?: number } = {}) {
  const t = new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(opts.long ? TextInputStyle.Paragraph : TextInputStyle.Short).setRequired(opts.required ?? false).setMaxLength(opts.max ?? (opts.long ? 4000 : 256));
  if (value) t.setValue(value.slice(0, opts.max ?? 4000));
  return new ActionRowBuilder<TextInputBuilder>().addComponents(t);
}

async function requireStaff(ctx: BotContext, member: Parameters<BotContext['isStaff']>[0]): Promise<boolean> {
  return ctx.isAdmin(member) || (await ctx.isStaff(member));
}

async function embedAutocomplete(ctx: BotContext, focused: string) {
  const rows = await ctx.db.savedEmbed.findMany({ where: { guildId: ctx.guildId, name: { contains: focused, mode: 'insensitive' } }, orderBy: { name: 'asc' }, take: 25 });
  return rows.map((r) => ({ name: r.name, value: r.name }));
}

export const embedsModule: BotModule = {
  commands: [
    {
      module: 'embeds',
      data: new SlashCommandBuilder()
        .setName('embed')
        .setDescription('Saved embeds (reusable message templates)')
        .addSubcommand((s) => s.setName('create').setDescription('Create a new saved embed').addStringOption((o) => o.setName('name').setDescription('Unique name').setRequired(true).setMaxLength(60)))
        .addSubcommand((s) => s.setName('edit').setDescription('Edit a saved embed').addStringOption((o) => o.setName('name').setDescription('Embed').setRequired(true).setAutocomplete(true)))
        .addSubcommand((s) => s.setName('resume').setDescription('Pick up an unsaved embed draft').addStringOption((o) => o.setName('draft').setDescription('Your draft').setRequired(true).setAutocomplete(true)))
        .addSubcommand((s) => s.setName('list').setDescription('List saved embeds'))
        .addSubcommand((s) => s.setName('show').setDescription('Preview a saved embed privately').addStringOption((o) => o.setName('name').setDescription('Embed').setRequired(true).setAutocomplete(true)))
        .addSubcommand((s) => s.setName('delete').setDescription('Delete a saved embed').addStringOption((o) => o.setName('name').setDescription('Embed').setRequired(true).setAutocomplete(true)))
        .addSubcommand((s) =>
          s
            .setName('send')
            .setDescription('Send a saved embed to a channel')
            .addStringOption((o) => o.setName('name').setDescription('Embed').setRequired(true).setAutocomplete(true))
            .addChannelOption((o) => o.setName('channel').setDescription('Where to send it').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)),
        )
        .toJSON(),
      async autocomplete(i, ctx) {
        if (i.options.getSubcommand() === 'resume') return i.respond(await draftAutocomplete(ctx, i.user.id, i.options.getFocused()));
        return i.respond(await embedAutocomplete(ctx, i.options.getFocused()));
      },
      async execute(i, ctx) {
        if (!(await requireStaff(ctx, i.member))) return i.reply(ephemeral('Only staff can manage saved embeds.'));
        const sub = i.options.getSubcommand();
        const name = i.options.getString('name') ?? '';
        if (sub === 'list') {
          const rows = await ctx.db.savedEmbed.findMany({ where: { guildId: ctx.guildId }, orderBy: { name: 'asc' }, take: 50 });
          const drafts = await listEmbedDrafts(ctx.db, ctx.guildId, i.user.id);
          const saved = rows.length ? rows.map((r) => `• **${r.name}**`).join('\n') : 'No saved embeds yet. Use `/embed create` or the dashboard editor.';
          const unsaved = drafts.length ? `\n\n**Your unsaved drafts** (use \`/embed resume\`)\n${drafts.map((d) => `• ${d.name || 'Untitled'}, edited ${ago(d.updatedAt)}`).join('\n')}` : '';
          return i.reply(ephemeral(saved + unsaved));
        }
        if (sub === 'resume') {
          const d = await loadDraft(ctx, i.user.id, i.options.getString('draft') ?? undefined);
          if (d === 'invalid') return i.reply(ephemeral('That draft has parts Discord can\'t show yet. Finish it on the dashboard under Embeds.'));
          if (!d) return i.reply(ephemeral('That draft is gone. It was saved, discarded, or older than 30 days.'));
          return i.reply({ ...editorView(ctx, d, i.member, 'Picked up where you left off 🥹'), flags: 64 } as never);
        }
        if (sub === 'create') {
          if (await ctx.db.savedEmbed.findFirst({ where: { guildId: ctx.guildId, name } })) return i.reply(ephemeral('An embed with that name already exists.'));
          const d = await persistDraft(ctx, i.user.id, { name, template: { content: undefined, embeds: [{ title: name, description: 'Edit me', color: 0x6d5dfc, timestamp: false, fields: [] }], components: [] } });
          return i.reply({ ...editorView(ctx, d, i.member), flags: 64 } as never);
        }
        const saved = await loadSavedEmbed(ctx.db, ctx.guildId, name);
        if (!saved) return i.reply(ephemeral('Saved embed not found.'));
        if (sub === 'edit') {
          if (!saved.template.embeds.length) return i.reply(ephemeral('This template has no embed; edit it in the dashboard.'));
          const d = await persistDraft(ctx, i.user.id, { embedId: saved.id, name: saved.name, template: saved.template });
          return i.reply({ ...editorView(ctx, d, i.member), flags: 64 } as never);
        }
        if (sub === 'show') {
          const r = await renderSavedEmbed(ctx, saved.id, variableContext(i.member, i.channel));
          return i.reply({ ...toMessageOptions(r!), flags: 64 } as never);
        }
        if (sub === 'delete') {
          const usedBy = await ctx.db.autoresponder.count({ where: { guildId: ctx.guildId, embedId: saved.id } });
          if (usedBy) return i.reply(ephemeral(`This embed is used by ${usedBy} autoresponder(s). Change them first.`));
          await ctx.db.savedEmbed.delete({ where: { id: saved.id } });
          await ctx.audit({ actorId: i.user.id, module: 'embeds', action: 'embed.delete', targetId: saved.id, meta: { name: saved.name } });
          return i.reply(ephemeral(`Deleted **${saved.name}**.`));
        }
        if (sub === 'send') {
          const target = i.options.getChannel('channel')?.id ?? i.channelId;
          const ch = textChannel(i.guild, target);
          if (!ch) return i.reply(ephemeral('Choose a text channel.'));
          const r = await renderSavedEmbed(ctx, saved.id, variableContext(i.member, ch));
          await ch.send(toMessageOptions(r!));
          await ctx.audit({ actorId: i.user.id, module: 'embeds', action: 'embed.send', targetId: saved.id, meta: { channelId: ch.id } });
          return i.reply(ephemeral(`Sent **${saved.name}** to <#${ch.id}>.`));
        }
        return undefined;
      },
    },
  ],
  components: [
    {
      prefix: 'em',
      module: 'embeds',
      async handle(i, ctx, parts) {
        const [action, a2, a3] = parts;
        // Buttons: em:<action>:<draftId>. Modals: em:m:<field>:<draftId>.
        const modalAction = action === 'm' ? a2 : undefined;
        const loaded = await loadDraft(ctx, i.user.id, action === 'm' ? a3 : a2);
        if (loaded === 'invalid') return i.reply(ephemeral('This draft has parts Discord can\'t show. Finish it on the dashboard under Embeds.'));
        if (!loaded) return i.reply(ephemeral('This draft is gone (saved, discarded, or from before an update). Use `/embed resume` to see your drafts.'));
        const d = loaded;
        const e = d.template.embeds[0]!;
        if (i.isButton()) {
          switch (action) {
            case 'text':
              return i.showModal(new ModalBuilder().setCustomId(`em:m:text:${d.id}`).setTitle('Title & description').addComponents(input('title', 'Title', e.title, { max: 256 }), input('url', 'Title link (https://…)', e.url, { max: 500 }), input('description', 'Description', e.description, { long: true })));
            case 'color':
              return i.showModal(new ModalBuilder().setCustomId(`em:m:color:${d.id}`).setTitle('Color').addComponents(input('color', 'Hex color like #6d5dfc', colorToHex(e.color), { required: true, max: 7 })));
            case 'author':
              return i.showModal(new ModalBuilder().setCustomId(`em:m:author:${d.id}`).setTitle('Author').addComponents(input('name', 'Author name', e.author?.name), input('icon', 'Author icon URL', e.author?.iconUrl, { max: 500 })));
            case 'footer':
              return i.showModal(new ModalBuilder().setCustomId(`em:m:footer:${d.id}`).setTitle('Footer').addComponents(input('text', 'Footer text', e.footer?.text, { long: true, max: 2048 }), input('icon', 'Footer icon URL', e.footer?.iconUrl, { max: 500 }), input('timestamp', 'Show timestamp? (yes/no)', e.timestamp ? 'yes' : 'no', { max: 3 })));
            case 'images':
              return i.showModal(new ModalBuilder().setCustomId(`em:m:images:${d.id}`).setTitle('Images').addComponents(input('thumb', 'Thumbnail URL or {user.avatar}', e.thumbnailUrl, { max: 500 }), input('image', 'Large image URL', e.imageUrl, { max: 500 })));
            case 'field':
              return i.showModal(new ModalBuilder().setCustomId(`em:m:field:${d.id}`).setTitle('Add field').addComponents(input('name', 'Field name', undefined, { required: true, max: 256 }), input('value', 'Field value', undefined, { required: true, long: true, max: 1024 }), input('inline', 'Inline? (yes/no)', 'no', { max: 3 })));
            case 'content':
              return i.showModal(new ModalBuilder().setCustomId(`em:m:content:${d.id}`).setTitle('Message text (outside embed)').addComponents(input('content', 'Content', d.template.content, { long: true, max: 2000 })));
            case 'clearfields':
              e.fields = [];
              await persistDraft(ctx, i.user.id, d);
              return i.update(editorView(ctx, d, i.member, 'Fields cleared.'));
            case 'cancel':
              await deleteEmbedDraft(ctx.db, ctx.guildId, i.user.id, d.id);
              return i.update({ content: 'Discarded changes.', embeds: [], components: [] });
            case 'save': {
              const parsed = savedEmbedInputSchema.safeParse({ name: d.name, template: d.template });
              if (!parsed.success) return i.update(editorView(ctx, d, i.member, `That didn't work 😣 ${parsed.error.issues[0]?.message ?? 'Invalid embed'}`));
              const row = d.embedId
                ? await ctx.db.savedEmbed.update({ where: { id: d.embedId }, data: { template: parsed.data.template as object } })
                : await ctx.db.savedEmbed.create({ data: { guildId: ctx.guildId, name: d.name, template: parsed.data.template as object, createdBy: i.user.id } });
              await ctx.audit({ actorId: i.user.id, module: 'embeds', action: d.embedId ? 'embed.update' : 'embed.create', targetId: row.id, meta: { name: d.name } });
              await deleteEmbedDraft(ctx.db, ctx.guildId, i.user.id, d.id);
              return i.update({ content: `Saved **${d.name}**. Use \`/embed send\` or pick it in any module.`, embeds: [], components: [] });
            }
          }
        }
        if (i.isModalSubmit() && action === 'm') {
          const f = (id: string) => {
            try {
              return i.fields.getTextInputValue(id).trim();
            } catch {
              return '';
            }
          };
          const next = structuredClone(d.template);
          const ne = next.embeds[0]!;
          switch (modalAction) {
            case 'text':
              ne.title = f('title') || undefined;
              ne.url = f('url') || undefined;
              ne.description = f('description') || undefined;
              break;
            case 'color': {
              const c = parseColor(f('color'));
              if (c === undefined) return i.reply(ephemeral('Use a hex color like #6d5dfc.'));
              ne.color = c;
              break;
            }
            case 'author':
              ne.author = f('name') ? { name: f('name'), iconUrl: f('icon') || undefined } : undefined;
              break;
            case 'footer':
              ne.footer = f('text') ? { text: f('text'), iconUrl: f('icon') || undefined } : undefined;
              ne.timestamp = /^y/i.test(f('timestamp'));
              break;
            case 'images':
              ne.thumbnailUrl = f('thumb') || undefined;
              ne.imageUrl = f('image') || undefined;
              break;
            case 'field':
              if (ne.fields.length >= 25) return i.reply(ephemeral('Embeds can have at most 25 fields.'));
              ne.fields.push({ name: f('name'), value: f('value'), inline: /^y/i.test(f('inline')) });
              break;
            case 'content':
              next.content = f('content') || undefined;
              break;
          }
          const check = messageTemplateSchema.safeParse(next);
          if (!check.success) return i.reply(ephemeral(`That didn't work 😣 ${check.error.issues[0]?.path.join('.')}: ${check.error.issues[0]?.message}`));
          d.template = check.data;
          await persistDraft(ctx, i.user.id, d);
          if (i.isFromMessage()) return i.update(editorView(ctx, d, i.member));
          return i.reply({ ...editorView(ctx, d, i.member), flags: 64 } as never);
        }
        return undefined;
      },
    },
    {
      // Saved-embed components with configured actions: `tpl:<embedId>:<key>`
      prefix: 'tpl',
      module: 'embeds',
      async handle(i, ctx, [embedId, key]) {
        if (!i.isMessageComponent() || !embedId || !key) return;
        const saved = await loadSavedEmbed(ctx.db, ctx.guildId, embedId);
        const actions = saved?.componentActions[key] ?? [];
        if (!actions.length) return i.reply(ephemeral('This button has no action configured.'));
        await i.deferReply({ flags: 64 });
        const channel = i.channel && !i.channel.isDMBased() ? i.channel : null;
        const results = await runActions(actions, createActionExecutor(ctx, { member: i.member, channel }), variableContext(i.member, channel), `Embed button ${saved!.name}`);
        const failed = results.filter((r) => !r.ok);
        return i.editReply({ content: failed.length ? `Done, but some actions failed: ${failed.map((f) => f.detail ?? f.type).join('; ')}` : 'Done!', allowedMentions: { parse: [] } });
      },
    },
  ],
};
