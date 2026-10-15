import { beforeEach, describe, expect, it } from 'vitest';
import { GUILD, hasDb, resetDb, testDb } from './helpers';
import { deleteEmbedDraft, embedDraftInputSchema, getEmbedDraft, listEmbedDrafts, MAX_DRAFTS_PER_USER, pruneEmbedDrafts, saveEmbedDraft } from '../src/embeds/index';

const draft = (name: string) => embedDraftInputSchema.parse({ name, template: { embeds: [{ title: name, fields: [] }], components: [] } });

describe.skipIf(!hasDb)('embed drafts', () => {
  beforeEach(resetDb);

  it('autosaves in place and only for the owner', async () => {
    const db = testDb();
    const { id } = await saveEmbedDraft(db, GUILD, 'alice', draft('one'));
    await saveEmbedDraft(db, GUILD, 'alice', draft('one, edited'), id);
    expect((await getEmbedDraft(db, GUILD, 'alice', id))?.name).toBe('one, edited');
    // Someone else's id never overwrites or reveals Alice's draft.
    const bob = await saveEmbedDraft(db, GUILD, 'bob', draft('bob'), id);
    expect(bob.id).not.toBe(id);
    expect(await getEmbedDraft(db, GUILD, 'bob', id)).toBeNull();
    await deleteEmbedDraft(db, GUILD, 'bob', id);
    expect(await getEmbedDraft(db, GUILD, 'alice', id)).not.toBeNull();
  });

  it('keeps the newest drafts per user and prunes old ones', async () => {
    const db = testDb();
    for (let i = 0; i < MAX_DRAFTS_PER_USER + 3; i++) await saveEmbedDraft(db, GUILD, 'alice', draft(`d${i}`));
    const rows = await listEmbedDrafts(db, GUILD, 'alice');
    expect(rows).toHaveLength(MAX_DRAFTS_PER_USER);
    expect(rows[0]!.name).toBe(`d${MAX_DRAFTS_PER_USER + 2}`);
    expect(await pruneEmbedDrafts(db, new Date(Date.now() + 31 * 86_400_000))).toBe(MAX_DRAFTS_PER_USER);
  });

  it('rejects oversized drafts', () => {
    expect(embedDraftInputSchema.safeParse({ name: 'x', template: { embeds: [{ description: 'a'.repeat(70_000) }], components: [] } }).success).toBe(false);
  });
});
