import { SlashCommandBuilder } from 'discord.js';
import { POLL_LIMITS, parsePollAnswers } from '@aio/core/community';
import { cardReply } from '../../runtime/cards.js';
import type { BotModule } from '../../commands/types.js';

const command = new SlashCommandBuilder()
  .setName('poll')
  .setDescription('Ask everyone a question with a native Discord poll')
  .addStringOption((o) => o.setName('question').setDescription('What you want to ask').setRequired(true).setMaxLength(POLL_LIMITS.question))
  .addStringOption((o) => o.setName('answers').setDescription('The choices, separated by | like Pizza | Tacos | Sushi').setRequired(true).setMaxLength(600))
  .addIntegerOption((o) => o.setName('hours').setDescription('How long voting stays open (default 24)').setMinValue(1).setMaxValue(768))
  .addBooleanOption((o) => o.setName('multiple').setDescription('Let people pick more than one answer'))
  .toJSON();

export const pollsModule: BotModule = {
  commands: [
    {
      module: 'polls',
      data: command,
      async execute(i, ctx) {
        const { settings } = await ctx.module('polls');
        const answers = parsePollAnswers(i.options.getString('answers', true));
        if (!answers.ok) return i.reply(await cardReply(ctx, { tone: 'warn', body: answers.error }));
        const hours = i.options.getInteger('hours') ?? Math.min(24, settings.maxDurationHours);
        if (hours > settings.maxDurationHours) return i.reply(await cardReply(ctx, { tone: 'warn', body: `Polls here can run for at most ${settings.maxDurationHours} hours.` }));
        return i.reply({
          poll: {
            question: { text: i.options.getString('question', true) },
            answers: answers.answers.map((text) => ({ text })),
            duration: hours,
            allowMultiselect: i.options.getBoolean('multiple') ?? false,
          },
          allowedMentions: { parse: [] },
        });
      },
    },
  ],
};
