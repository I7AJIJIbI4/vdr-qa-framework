import { must } from '../../src/api/client';
import { expect, test } from '../../src/fixtures';
import { ExplorerPage } from '../../src/pages/explorer-page';
import { LoginPage } from '../../src/pages/login-page';
import { ShareDialog } from '../../src/pages/share-dialog';

test.describe('Sharing journeys', () => {
  test('public link: anonymous visitor gets a read-only view until the owner revokes @smoke', async ({ page, browser, owner, pdf }) => {
    const folder = must(await owner.api.createFolder({ name: 'Investor Pack', dataRoomId: owner.roomId }));
    await owner.api.uploadPdf(owner.roomId, 'Teaser.pdf', await pdf('Teaser'), folder.id);

    await new LoginPage(page).loginAs(owner);
    await page.goto(`/folder/${folder.id}`);
    const dialog = new ShareDialog(page);
    await dialog.openFromToolbar();
    const link = await dialog.ensurePublicLink();
    expect(link).toMatch(/\/share\/[\w-]{20,}$/);

    // A separate, logged-out browser context for the anonymous visitor (same locale as the project).
    const visitorContext = await browser.newContext({ locale: 'en-US' });
    try {
      const visitor = await visitorContext.newPage();
      await visitor.goto(link);
      await expect(visitor.getByText('Teaser.pdf')).toBeVisible();
      await expect(visitor.getByRole('button', { name: /upload|new folder|rename|delete|share/i })).toHaveCount(0);

      await dialog.revokePublicLink();
      await visitor.reload();
      await expect(visitor.getByText('This link has been revoked').first()).toBeVisible();
    } finally {
      await visitorContext.close();
    }
  });

  test('invited viewer finds the folder under "Shared with me" and cannot edit @smoke', async ({ page, owner, newActor, pdf }) => {
    const viewer = await newActor('viewer');
    const folder = must(await owner.api.createFolder({ name: 'Due Diligence', dataRoomId: owner.roomId }));
    await owner.api.uploadPdf(owner.roomId, 'Cap Table.pdf', await pdf('Cap Table'), folder.id);
    must(await owner.api.share({ resourceType: 'FOLDER', resourceId: folder.id, mode: 'USER', granteeEmail: viewer.email }));

    await new LoginPage(page).loginAs(viewer);
    await page.getByRole('link', { name: 'Shared with me' }).click();
    await page.locator('main').getByText('Due Diligence').click();

    const explorer = new ExplorerPage(page);
    await expect(explorer.row('Cap Table.pdf')).toBeVisible();
    await expect(page.getByRole('button', { name: /upload|new folder|share/i })).toHaveCount(0);
    // the row menu offers read-only actions only
    await explorer.row('Cap Table.pdf').getByRole('button').last().click();
    await expect(page.getByRole('menuitem', { name: 'Download' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: /rename|move|share|delete/i })).toHaveCount(0);
    await page.keyboard.press('Escape');
    // breadcrumb is shown, but must not reveal the owner's room
    await expect(explorer.breadcrumb()).toContainText('Due Diligence');
    await expect(explorer.breadcrumb()).not.toContainText('My Data Room');

    // owner revokes while the viewer is on the page
    const share = must(await owner.api.listShares('FOLDER', folder.id)).items[0];
    must(await owner.api.revokeShare(share.id));
    await page.reload();
    await expect(page.getByText('Folder not found')).toBeVisible();
  });
});
