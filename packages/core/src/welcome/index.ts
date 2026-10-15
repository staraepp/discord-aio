import type { MessageTemplate } from '@aio/discord-ui';

/**
 * Welcome/goodbye reuse the shared saved-embed system. The final template is
 * the chosen saved embed with the module's plain content placed around it.
 */
export function composeGreeting(params: { content: string; savedTemplate: MessageTemplate | null }): MessageTemplate | null {
  const content = params.content.trim();
  if (!params.savedTemplate) return content ? { content, embeds: [], components: [] } : null;
  return { ...params.savedTemplate, content: content || params.savedTemplate.content };
}
