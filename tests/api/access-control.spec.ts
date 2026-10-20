import { must, type Res, type VdrApi } from '../../src/api/client';
import { expect, test, type Actor } from '../../src/fixtures';

/**
 * Authorization matrix. One room is seeded:
 *
 *   room/
 *     Outside/           <- not shared
 *       outside.pdf
 *     Shared/            <- USER share to `viewer`
 *       inside.pdf
 *       Nested/
 *
 * Every (actor, operation) pair has an expected status. A data room is a
 * security product, so the matrix is the regression net: any change in
 * resolveAccess shows up here as a cell that flipped.
 */
interface Seed {
  roomId: string;
  outside: string;
  outsideFile: string;
  shared: string;
  nested: string;
  insideFile: string;
}

type Op = (api: VdrApi, s: Seed) => Promise<Res<unknown>>;

const reads: Record<string, Op> = {
  'GET room': (a, s) => a.getDataRoom(s.roomId),
  'GET room contents': (a, s) => a.roomContents(s.roomId),
  'GET shared folder contents': (a, s) => a.folderContents(s.shared),
  'GET nested folder contents': (a, s) => a.folderContents(s.nested),
  'GET outside folder contents': (a, s) => a.folderContents(s.outside),
  'GET inside file': (a, s) => a.getFile(s.insideFile),
  'GET inside file view-url': (a, s) => a.viewUrl(s.insideFile),
  'GET outside file view-url': (a, s) => a.viewUrl(s.outsideFile),
};

const writes: Record<string, Op> = {
  'POST folder in shared': (a, s) => a.createFolder({ name: 'intruder', dataRoomId: s.roomId, parentId: s.shared }),
  'PATCH shared folder': (a, s) => a.renameFolder(s.shared, 'renamed'),
  'DELETE nested folder': (a, s) => a.deleteFolder(s.nested),
  'GET delete-preview': (a, s) => a.deletePreview(s.shared),
  'POST upload-intent': (a, s) => a.uploadIntent({ dataRoomId: s.roomId, folderId: s.shared, name: 'x.pdf', size: 1, mimeType: 'application/pdf' }),
  'PATCH inside file': (a, s) => a.renameFile(s.insideFile, 'renamed.pdf'),
  'PATCH move inside file': (a, s) => a.moveFile(s.insideFile, null),
  'DELETE inside file': (a, s) => a.deleteFile(s.insideFile),
  'POST share shared folder': (a, s) => a.share({ resourceType: 'FOLDER', resourceId: s.shared, mode: 'PUBLIC_LINK' }),
  'GET shares of shared folder': (a, s) => a.listShares('FOLDER', s.shared),
};

const OK = [200, 201];
// Unauthorized access is reported as 404 so existence never leaks; anonymous gets 401.
const expected: Record<'owner' | 'viewer' | 'stranger' | 'anonymous', (op: string) => number[]> = {
  owner: () => [...OK, 204],
  viewer: (op) =>
    ['GET shared folder contents', 'GET nested folder contents', 'GET inside file', 'GET inside file view-url'].includes(op)
      ? OK
      : [404],
  stranger: () => [404],
  anonymous: () => [401],
};

async function seed(owner: Actor, viewer: Actor, pdf: Buffer): Promise<Seed> {
  const { api, roomId } = owner;
  const outside = must(await api.createFolder({ name: 'Outside', dataRoomId: roomId })).id;
  const shared = must(await api.createFolder({ name: 'Shared', dataRoomId: roomId })).id;
  const nested = must(await api.createFolder({ name: 'Nested', dataRoomId: roomId, parentId: shared })).id;
  const outsideFile = (await api.uploadPdf(roomId, 'outside.pdf', pdf, outside)).id;
  const insideFile = (await api.uploadPdf(roomId, 'inside.pdf', pdf, shared)).id;
  must(await api.share({ resourceType: 'FOLDER', resourceId: shared, mode: 'USER', granteeEmail: viewer.email }));
  return { roomId, outside, outsideFile, shared, nested, insideFile };
}

test.describe('Access control matrix @security', () => {
  // Each cell is a real round-trip and the seed uploads files: ~40s alone, more under full-suite load.
  test.slow();

  for (const actor of ['viewer', 'stranger', 'anonymous', 'owner'] as const) {
    test(`${actor}: reads and writes`, async ({ owner, newActor, anon, pdf }) => {
      const viewer = await newActor('viewer');
      const stranger = await newActor('stranger');
      const s = await seed(owner, viewer, await pdf());
      const api = { owner: owner.api, viewer: viewer.api, stranger: stranger.api, anonymous: anon }[actor];

      // Reads first, then writes. For the owner the writes run in an order where each one is still valid
      // (rename before delete, move before delete), so every cell is expected to succeed.
      const ops = { ...reads, ...writes };
      const failures: string[] = [];
      for (const [name, op] of Object.entries(ops)) {
        const { status } = await op(api, s);
        if (!expected[actor](name).includes(status)) failures.push(`${name}: got ${status}, want ${expected[actor](name)}`);
      }
      expect(failures, failures.join('\n')).toEqual([]);

      if (actor !== 'owner') {
        // Nothing a non-owner did may have changed the room.
        const after = await owner.api.collectAll((q) => owner.api.folderContents(s.shared, q));
        expect(after.map((i) => i.name).sort()).toEqual(['Nested', 'inside.pdf']);
      }
    });
  }

  test('viewer breadcrumbs stop at the share boundary (no ancestor names leak)', async ({ owner, newActor, pdf }) => {
    const viewer = await newActor('viewer');
    const s = await seed(owner, viewer, await pdf());
    const crumbs = must(await viewer.api.breadcrumbs(s.nested));
    expect(crumbs.accessLevel).toBe('VIEWER');
    expect(crumbs.dataRoomName).toBeNull();
    expect(crumbs.folders.map((f) => f.name)).toEqual(['Shared', 'Nested']);
  });

  test('access follows the file: moving it out of a shared folder removes viewer access', async ({ owner, newActor, pdf }) => {
    const viewer = await newActor('viewer');
    const s = await seed(owner, viewer, await pdf());
    expect((await viewer.api.getFile(s.insideFile)).status).toBe(200);
    must(await owner.api.moveFile(s.insideFile, s.outside));
    expect((await viewer.api.getFile(s.insideFile)).status).toBe(404);
  });
});
