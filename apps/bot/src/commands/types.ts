import type {
  AutocompleteInteraction,
  ChatInputCommandInteraction,
  MessageComponentInteraction,
  ModalSubmitInteraction,
  RESTPostAPIChatInputApplicationCommandsJSONBody,
} from 'discord.js';
import type { ModuleId } from '@aio/core';
import type { BotContext } from '../runtime/context.js';

export type CommandModule = ModuleId | 'core';

export interface SlashCommand {
  module: CommandModule;
  data: RESTPostAPIChatInputApplicationCommandsJSONBody;
  execute(i: ChatInputCommandInteraction<'cached'>, ctx: BotContext): Promise<unknown>;
  autocomplete?(i: AutocompleteInteraction<'cached'>, ctx: BotContext): Promise<unknown>;
  /** Autocomplete only suggests; whatever the user typed is already valid (e.g. a search). */
  suggestionsOnly?: boolean;
}

export interface ComponentHandler {
  /** First segment of the custom ID, e.g. `mp` for `mp:skip:<id>`. */
  prefix: string;
  module: CommandModule;
  handle(i: MessageComponentInteraction<'cached'> | ModalSubmitInteraction<'cached'>, ctx: BotContext, parts: string[]): Promise<unknown>;
}

export interface BotModule {
  commands?: SlashCommand[];
  components?: ComponentHandler[];
}
