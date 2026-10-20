import { expect, knownBug, test } from '../../src/fixtures';
import { must } from '../../src/api/client';

test.describe('Folders', () => {
  test('create nested folders and read breadcrumbs @smoke', async ({ owner }) => {
    const { api, roomId } = owner;
    const legal = must(await api.createFolder({ name: 'Legal', dataRoomId: roomId }));
    const contracts = must(await api.createFolder({ name: 'Contracts', dataRoomId: roomId, parentId: legal.id }));

    const crumbs = must(await api.breadcrumbs(contracts.id));
    expect(crumbs.accessLevel).toBe('OWNER');
    expect(crumbs.dataRoomName).toBe('My Data Room');
    expect(crumbs.folders.map((f) => f.name)).toEqual(['Legal', 'Contracts']);

    const children = must(await api.folderContents(legal.id)).items;
    expect(children).toEqual([expect.objectContaining({ type: 'folder', name: 'Contracts' })]);
  });

  test('sibling folder names are unique ignoring case; same name allowed elsewhere', async ({ owner }) => {
    const { api, roomId } = owner;
    const a = must(await api.createFolder({ name: 'Finance', dataRoomId: roomId }));
    expect((await api.createFolder({ name: 'FINANCE', dataRoomId: roomId })).status).toBe(409);
    expect((await api.createFolder({ name: 'Finance', dataRoomId: roomId, parentId: a.id })).status).toBe(201);
  });

  test('rename: conflict is 409, case-only rename of itself is allowed', async ({ owner }) => {
    const { api, roomId } = owner;
    const a = must(await api.createFolder({ name: 'Alpha', dataRoomId: roomId }));
    must(await api.createFolder({ name: 'Beta', dataRoomId: roomId }));
    expect((await api.renameFolder(a.id, 'beta')).status).toBe(409);
    expect((await api.renameFolder(a.id, 'ALPHA')).body.name).toBe('ALPHA');
  });

  test('name validation: empty, whitespace, over 200 chars rejected; trimmed on save', async ({ owner }) => {
    const { api, roomId } = owner;
    for (const name of ['', '   ', 'x'.repeat(201)]) {
      expect((await api.createFolder({ name, dataRoomId: roomId })).status, JSON.stringify(name)).toBe(400);
    }
    expect(must(await api.createFolder({ name: '  Padded  ', dataRoomId: roomId })).name).toBe('Padded');
  });

  test('parent must belong to the same room', async ({ owner, stranger }) => {
    const foreign = must(await stranger.api.createFolder({ name: 'Theirs', dataRoomId: stranger.roomId }));
    const res = await owner.api.createFolder({ name: 'x', dataRoomId: owner.roomId, parentId: foreign.id });
    expect(res.status).toBe(404);
  });

  test('delete preview counts the whole subtree and delete removes it @smoke', async ({ owner, pdf }) => {
    const { api, roomId } = owner;
    const top = must(await api.createFolder({ name: 'Top', dataRoomId: roomId }));
    const mid = must(await api.createFolder({ name: 'Mid', dataRoomId: roomId, parentId: top.id }));
    const leaf = must(await api.createFolder({ name: 'Leaf', dataRoomId: roomId, parentId: mid.id }));
    const bytes = await pdf();
    await api.uploadPdf(roomId, 'a.pdf', bytes, top.id);
    const deep = await api.uploadPdf(roomId, 'b.pdf', bytes, leaf.id);

    expect(must(await api.deletePreview(top.id))).toEqual({
      folderCount: 2,
      fileCount: 2,
      totalSize: bytes.length * 2,
    });

    expect((await api.deleteFolder(top.id)).status).toBe(204);
    expect((await api.folderContents(leaf.id)).status).toBe(404);
    expect((await api.getFile(deep.id)).status).toBe(404);
    expect(must(await api.roomContents(roomId)).items).toEqual([]);
  });

  test('keyset pagination returns every child exactly once, folders before files', async ({ owner, pdf }) => {
    const { api, roomId } = owner;
    const parent = must(await api.createFolder({ name: 'Paged', dataRoomId: roomId }));
    const folderNames = Array.from({ length: 7 }, (_, i) => `F${i}`);
    for (const name of folderNames) must(await api.createFolder({ name, dataRoomId: roomId, parentId: parent.id }));
    const bytes = await pdf();
    for (let i = 0; i < 4; i++) await api.uploadPdf(roomId, `doc-${i}.pdf`, bytes, parent.id);

    // limit=3 forces a page that straddles the folder/file boundary
    const items = await api.collectAll((q) => api.folderContents(parent.id, q), 3);
    expect(items.map((i) => i.name)).toEqual([...folderNames, 'doc-0.pdf', 'doc-1.pdf', 'doc-2.pdf', 'doc-3.pdf']);
  });

  test('pagination input validation', async ({ owner }) => {
    const { api, roomId } = owner;
    expect((await api.roomContents(roomId, '?limit=0')).status).toBe(400);
    expect((await api.roomContents(roomId, '?limit=101')).status).toBe(400);
    expect((await api.roomContents(roomId, '?cursor=not-a-cursor')).status).toBe(400);
    expect((await api.folderContents('not-a-uuid')).status).toBe(400);
  });

  test('BUG-07: data room name cannot be whitespace only', async ({ owner }) => {
    const { status } = await owner.api.createDataRoom('   ');
    expect(status, 'must not be a server error').toBeLessThan(500);

    knownBug('BUG-07', 'POST /data-rooms trims after validation and stores ""');
    expect(status).toBe(400);
  });
});
