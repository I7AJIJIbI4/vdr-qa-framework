import { env } from '../../src/config';
import { must } from '../../src/api/client';
import { qaEmail } from '../../src/data/names';
import { expect, knownBug, test } from '../../src/fixtures';

test.describe('Sharing - per-user', () => {
  test('grant -> appears in "shared with me" -> revoke removes API access immediately @smoke', async ({ owner, newActor }) => {
    const viewer = await newActor('viewer');
    const folder = must(await owner.api.createFolder({ name: 'Deal', dataRoomId: owner.roomId }));
    // grantee email is normalised (trim + lower-case)
    const share = must(
      await owner.api.share({ resourceType: 'FOLDER', resourceId: folder.id, mode: 'USER', granteeEmail: `  ${viewer.email.toUpperCase()} ` }),
    );
    expect(share.granteeEmail).toBe(viewer.email);

    const received = must(await viewer.api.receivedShares()).items;
    expect(received).toEqual([expect.objectContaining({ resourceType: 'FOLDER', resourceId: folder.id, resourceName: 'Deal' })]);
    expect((await viewer.api.folderContents(folder.id)).status).toBe(200);

    expect((await owner.api.revokeShare(share.id)).status).toBe(204);
    expect((await viewer.api.folderContents(folder.id)).status).toBe(404);
    expect(must(await viewer.api.receivedShares()).items).toEqual([]);
  });

  test('sharing is idempotent and only the owner can revoke', async ({ owner, newActor }) => {
    const viewer = await newActor('viewer');
    const body = { resourceType: 'DATAROOM' as const, resourceId: owner.roomId, mode: 'USER' as const, granteeEmail: viewer.email };
    const first = must(await owner.api.share(body));
    const second = must(await owner.api.share(body));
    expect(second.id).toBe(first.id);
    expect((await viewer.api.revokeShare(first.id)).status).toBe(404);
  });

  test('deleting a shared folder removes it from the viewer without errors', async ({ owner, newActor }) => {
    const viewer = await newActor('viewer');
    const folder = must(await owner.api.createFolder({ name: 'Temp', dataRoomId: owner.roomId }));
    must(await owner.api.share({ resourceType: 'FOLDER', resourceId: folder.id, mode: 'USER', granteeEmail: viewer.email }));
    must(await owner.api.deleteFolder(folder.id));
    expect((await viewer.api.folderContents(folder.id)).status).toBe(404);
    expect(must(await viewer.api.receivedShares()).items).toEqual([]);
  });

  test('share request validation', async ({ owner }) => {
    const folder = must(await owner.api.createFolder({ name: 'V', dataRoomId: owner.roomId }));
    expect((await owner.api.share({ resourceType: 'FOLDER', resourceId: folder.id, mode: 'USER' })).status).toBe(400);
    expect((await owner.api.share({ resourceType: 'FOLDER', resourceId: folder.id, mode: 'USER', granteeEmail: 'nope' })).status).toBe(400);
    // resource type that does not match the id
    expect((await owner.api.share({ resourceType: 'FILE', resourceId: folder.id, mode: 'PUBLIC_LINK' })).status).toBe(404);
  });

  test('BUG-01: a per-user share cannot be claimed by whoever registers that email first @security', async ({ owner, anon }) => {
    knownBug('BUG-01', 'no email verification; shares to not-yet-registered emails go to the first registrant');
    const target = qaEmail('cfo');
    must(await owner.api.share({ resourceType: 'DATAROOM', resourceId: owner.roomId, mode: 'USER', granteeEmail: target }));

    // An attacker who guesses/knows the invited address simply signs up with it.
    const { accessToken } = must(await anon.register({ name: 'Not the CFO', email: target, password: env.password }));
    expect((await anon.as(accessToken).roomContents(owner.roomId)).status).toBe(404);
  });

  test('BUG-08: "shared with me" never lists items the recipient cannot open', async ({ owner, newActor }) => {
    knownBug('BUG-08', 'shares on never-uploaded files (and self-shares) are listed');
    const viewer = await newActor('viewer');
    const pending = must(
      await owner.api.uploadIntent({ dataRoomId: owner.roomId, name: 'pending.pdf', size: 10, mimeType: 'application/pdf' }),
    );
    must(await owner.api.share({ resourceType: 'FILE', resourceId: pending.fileId, mode: 'USER', granteeEmail: viewer.email }));

    for (const item of must(await viewer.api.receivedShares()).items) {
      expect((await viewer.api.getFile(item.resourceId)).status, item.resourceName).toBe(200);
    }
  });
});

test.describe('Sharing - public links', () => {
  test('folder link: anonymous can browse the subtree and view files, nothing outside @smoke @security', async ({ owner, anon, pdf }) => {
    const { api, roomId } = owner;
    const bytes = await pdf();
    const shared = must(await api.createFolder({ name: 'Public', dataRoomId: roomId }));
    const nested = must(await api.createFolder({ name: 'Nested', dataRoomId: roomId, parentId: shared.id }));
    const inside = await api.uploadPdf(roomId, 'in.pdf', bytes, nested.id);
    const outside = await api.uploadPdf(roomId, 'out.pdf', bytes);
    const link = must(await api.share({ resourceType: 'FOLDER', resourceId: shared.id, mode: 'PUBLIC_LINK' }));
    const token = link.token!;

    expect(must(await anon.publicShare(token))).toMatchObject({ resourceType: 'FOLDER', resourceName: 'Public' });
    expect(must(await anon.publicFolderContents(token, nested.id)).items.map((i) => i.name)).toEqual(['in.pdf']);
    const view = await anon.fetchSigned(must(await anon.publicViewUrl(token, inside.id)).url);
    expect(view.body.equals(bytes)).toBe(true);

    // id substitution: same token, resources outside the shared subtree
    expect((await anon.publicViewUrl(token, outside.id)).status).toBe(404);
    expect((await anon.publicRootContents(token)).status).toBe(404);
  });

  test('link is reused while active; revoking gives 410, unknown token 404', async ({ owner, anon }) => {
    const body = { resourceType: 'DATAROOM' as const, resourceId: owner.roomId, mode: 'PUBLIC_LINK' as const };
    const a = must(await owner.api.share(body));
    const b = must(await owner.api.share(body));
    expect(b.token).toBe(a.token);
    expect(a.token!.length).toBeGreaterThanOrEqual(32);

    must(await owner.api.revokeShare(a.id));
    expect((await anon.publicShare(a.token!)).status).toBe(410);
    expect((await anon.publicRootContents(a.token!)).status).toBe(410);
    expect((await anon.publicShare('definitely-not-a-token')).status).toBe(404);

    const fresh = must(await owner.api.share(body));
    expect(fresh.token).not.toBe(a.token);
  });

  test('a public token never grants authenticated-API access to the owner\'s resources', async ({ owner, stranger }) => {
    must(await owner.api.share({ resourceType: 'DATAROOM', resourceId: owner.roomId, mode: 'PUBLIC_LINK' }));
    expect((await stranger.api.roomContents(owner.roomId)).status).toBe(404);
  });
});
