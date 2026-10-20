import { expect, knownBug, test } from '../../src/fixtures';
import { must } from '../../src/api/client';
import { expectedConflictName, findDuplicateNames } from '../../src/data/conflict-name';
import { isPdf } from '../../src/data/pdf';

test.describe('Files', () => {
  test('upload -> view -> download round-trip returns the same bytes @smoke', async ({ owner, pdf }) => {
    const { api, roomId } = owner;
    const bytes = await pdf('Round trip');
    const file = await api.uploadPdf(roomId, 'Term Sheet.pdf', bytes);

    const detail = must(await api.getFile(file.id));
    expect(detail).toMatchObject({ name: 'Term Sheet.pdf', size: bytes.length, mimeType: 'application/pdf' });

    const view = await api.fetchSigned(must(await api.viewUrl(file.id)).url);
    expect(view.status).toBe(200);
    expect(view.headers['content-type']).toBe('application/pdf');
    expect(view.headers['content-disposition'] ?? '').not.toMatch(/attachment/);
    expect(view.body.equals(bytes)).toBe(true);

    const download = await api.fetchSigned(must(await api.downloadUrl(file.id)).url);
    expect(download.headers['content-disposition']).toContain('attachment; filename="Term Sheet.pdf"');
  });

  test('sequential same-name uploads are suffixed, case-insensitively', async ({ owner, pdf }) => {
    const { api, roomId } = owner;
    const bytes = await pdf();
    const names: string[] = [];
    for (const requested of ['nda.pdf', 'NDA.PDF', 'nda.pdf']) {
      const expected = expectedConflictName(requested, names);
      const got = (await api.uploadPdf(roomId, requested, bytes)).name;
      expect(got).toBe(expected);
      names.push(got);
    }
    expect(names).toEqual(['nda.pdf', 'NDA (1).PDF', 'nda (2).pdf']);
  });

  test('rename resolves conflicts with a suffix instead of failing', async ({ owner, pdf }) => {
    const { api, roomId } = owner;
    const bytes = await pdf();
    await api.uploadPdf(roomId, 'a.pdf', bytes);
    const b = await api.uploadPdf(roomId, 'b.pdf', bytes);
    expect(must(await api.renameFile(b.id, 'A.pdf')).name).toBe('A (1).pdf');
    expect(must(await api.renameFile(b.id, '  spaced.pdf  ')).name).toBe('spaced.pdf');
    expect((await api.renameFile(b.id, '   ')).status).toBe(400);
  });

  test('move between folders, to root, and with a name clash at the destination', async ({ owner, pdf }) => {
    const { api, roomId } = owner;
    const bytes = await pdf();
    const target = must(await api.createFolder({ name: 'Target', dataRoomId: roomId }));
    await api.uploadPdf(roomId, 'dup.pdf', bytes, target.id);
    const file = await api.uploadPdf(roomId, 'dup.pdf', bytes);

    const moved = must(await api.moveFile(file.id, target.id));
    expect(moved).toMatchObject({ folderId: target.id, name: 'dup (1).pdf' });

    const back = must(await api.moveFile(file.id, null));
    expect(back.folderId).toBeNull();
  });

  test('BUG-11: unknown body fields are rejected instead of silently ignored', async ({ owner, pdf }) => {
    const { api, roomId } = owner;
    const source = must(await api.createFolder({ name: 'Source', dataRoomId: roomId }));
    const target = must(await api.createFolder({ name: 'Target', dataRoomId: roomId }));
    const file = await api.uploadPdf(roomId, 'contract.pdf', await pdf(), source.id);

    knownBug('BUG-11', 'a mistyped move field is dropped and the file moves to the room root with 200');
    // `folderId` is not part of MoveFileDto (the field is `targetFolderId`)
    const res = await api.raw<{ folderId: string | null }>('PATCH', `/files/${file.id}/move`, { folderId: target.id });
    const after = must(await api.getFile(file.id));
    expect.soft(after.folderId, 'file must stay where it was').toBe(source.id);
    expect(res.status).toBe(400);
  });

  test('cannot move a file into another user\'s folder', async ({ owner, stranger, pdf }) => {
    const file = await owner.api.uploadPdf(owner.roomId, 'x.pdf', await pdf());
    const foreign = must(await stranger.api.createFolder({ name: 'Theirs', dataRoomId: stranger.roomId }));
    expect((await owner.api.moveFile(file.id, foreign.id)).status).toBe(404);
  });

  test('delete removes the file from listing and its links stop resolving', async ({ owner, pdf }) => {
    const { api, roomId } = owner;
    const file = await api.uploadPdf(roomId, 'gone.pdf', await pdf());
    expect((await api.deleteFile(file.id)).status).toBe(204);
    expect((await api.getFile(file.id)).status).toBe(404);
    expect((await api.viewUrl(file.id)).status).toBe(404);
  });

  test('upload intent validation: type and declared size', async ({ owner }) => {
    const base = { dataRoomId: owner.roomId, name: 'x.pdf', size: 10, mimeType: 'application/pdf' };
    expect((await owner.api.uploadIntent({ ...base, mimeType: 'text/plain' })).status).toBe(400);
    expect((await owner.api.uploadIntent({ ...base, size: 0 })).status).toBe(400);
    expect((await owner.api.uploadIntent({ ...base, size: 50 * 1024 * 1024 + 1 })).status).toBe(400);
  });

  test('files whose upload never completed are not listed or readable', async ({ owner }) => {
    const intent = must(
      await owner.api.uploadIntent({ dataRoomId: owner.roomId, name: 'pending.pdf', size: 10, mimeType: 'application/pdf' }),
    );
    expect(must(await owner.api.roomContents(owner.roomId)).items).toEqual([]);
    expect((await owner.api.getFile(intent.fileId)).status).toBe(404);
  });

  test('BUG-02: concurrent same-name uploads never produce duplicate names', async ({ owner, pdf }) => {
    const { api, roomId } = owner;
    const bytes = await pdf();
    // A fix may legitimately reject the losers (e.g. 409), so failed uploads are fine here.
    const results = await Promise.allSettled(Array.from({ length: 4 }, () => api.uploadPdf(roomId, 'Term Sheet.pdf', bytes)));
    expect(results.some((r) => r.status === 'fulfilled'), 'at least one upload must succeed').toBe(true);
    const names = must(await api.roomContents(roomId)).items.map((i) => i.name);

    knownBug('BUG-02', 'parallel same-name uploads all receive the same name');
    expect(findDuplicateNames(names)).toEqual([]);
  });

  test('BUG-03: an abandoned upload does not reserve the file name', async ({ owner, pdf }) => {
    const { api, roomId } = owner;
    const bytes = await pdf();
    // first attempt dies after the intent (tab closed / network drop)
    must(await api.uploadIntent({ dataRoomId: roomId, name: 'Q3 Report.pdf', size: bytes.length, mimeType: 'application/pdf' }));
    const retry = await api.uploadPdf(roomId, 'Q3 Report.pdf', bytes);

    knownBug('BUG-03', 'pending (invisible) rows take part in conflict resolution forever');
    expect(retry.name).toBe('Q3 Report.pdf');
  });

  test('BUG-05: stored content must actually be a PDF', async ({ owner }) => {
    const { api, roomId } = owner;
    const html = Buffer.from('<html><body>not a pdf</body></html>');
    const intent = must(await api.uploadIntent({ dataRoomId: roomId, name: 'invoice.exe', size: html.length, mimeType: 'application/pdf' }));
    // The bytes must really reach storage, otherwise a "rejection" below would prove nothing.
    expect(await api.putToStorage(intent.uploadUrl, html, 'text/html')).toBeLessThan(300);
    const complete = await api.completeUpload(intent.fileId);
    const stored = complete.status < 300 ? await api.fetchSigned(must(await api.viewUrl(intent.fileId)).url) : null;

    knownBug('BUG-05', 'server trusts the client-declared MIME type; bytes and extension are never checked');
    // Fixed = rejected with a 4xx, or whatever is served is a real PDF. A 5xx is not a fix.
    if (stored === null) expect(complete.status, 'rejection must be a 4xx').toBeLessThan(500);
    else expect(isPdf(stored.body), 'non-PDF bytes were accepted and are served as a PDF').toBe(true);
  });

  test('BUG-06: completing an upload whose bytes never arrived is a 4xx, not a 500', async ({ owner }) => {
    const intent = must(
      await owner.api.uploadIntent({ dataRoomId: owner.roomId, name: 'never.pdf', size: 10, mimeType: 'application/pdf' }),
    );
    const { status } = await owner.api.completeUpload(intent.fileId);

    knownBug('BUG-06', 'storage "object not found" is not recognised and surfaces as 500');
    expect(status >= 400 && status < 500, `got ${status}`).toBe(true);
  });
});
