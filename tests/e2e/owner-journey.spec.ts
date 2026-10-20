import { must } from '../../src/api/client';
import { expect, knownBug, test } from '../../src/fixtures';
import { ExplorerPage } from '../../src/pages/explorer-page';
import { LoginPage } from '../../src/pages/login-page';

test.describe('Owner journey', () => {
  test('organize a room: folder, upload, rename, delete with warning @smoke', async ({ page, owner, pdf }) => {
    await new LoginPage(page).loginAs(owner);
    const explorer = new ExplorerPage(page);
    await expect(explorer.main.getByText('This folder is empty')).toBeVisible();

    await explorer.createFolder('Legal');
    await explorer.expectRow('Legal');
    await explorer.open('Legal');
    await expect(explorer.breadcrumb()).toContainText('My Data Room');
    await expect(explorer.breadcrumb()).toContainText('Legal');

    // two PDFs and one non-PDF in a single selection
    await explorer.upload([
      { name: 'NDA.pdf', mimeType: 'application/pdf', buffer: await pdf('NDA') },
      { name: 'Term Sheet.pdf', mimeType: 'application/pdf', buffer: await pdf('Term Sheet') },
      { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('not a pdf') },
    ]);
    await expect(explorer.toast('notes.txt is not a PDF')).toBeVisible();
    await expect(page.getByText('Uploads complete')).toBeVisible({ timeout: 30_000 });
    await expect.poll(() => explorer.rowNames()).toEqual(['NDA.pdf', 'Term Sheet.pdf']);

    // rename keeps the extension; only the base name is editable
    await explorer.rowAction('NDA.pdf', 'Rename');
    const nameInput = explorer.dialog.getByLabel('File name');
    await expect(nameInput).toHaveValue('NDA');
    await nameInput.fill('Mutual NDA');
    await page.keyboard.press('Enter');
    await explorer.expectRow('Mutual NDA.pdf');

    // deleting a non-empty folder warns about what goes with it
    await page.goto('/');
    await explorer.rowAction('Legal', 'Delete');
    await expect(explorer.dialog).toContainText('2 files');
    await expect(explorer.dialog).toContainText('cannot be undone');
    await explorer.dialog.getByRole('button', { name: 'Delete' }).click();
    await expect(explorer.row('Legal')).toHaveCount(0);
  });

  test('deep links survive a reload and unknown ids show a way back', async ({ page, owner }) => {
    const folder = must(await owner.api.createFolder({ name: 'Deep', dataRoomId: owner.roomId }));
    await new LoginPage(page).loginAs(owner);

    await page.goto(`/folder/${folder.id}`);
    await page.reload();
    await expect(new ExplorerPage(page).breadcrumb()).toContainText('Deep');

    await page.goto('/folder/00000000-0000-4000-8000-000000000000');
    await expect(page.getByText('Folder not found')).toBeVisible();
    await expect(page.getByRole('link', { name: /back/i })).toBeVisible();
  });

  test('signing out ends the session in the browser', async ({ page, owner }) => {
    await new LoginPage(page).loginAs(owner);
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/login$/);
    await page.goto('/');
    await expect(page).toHaveURL(/\/login$/);
  });

  test('BUG-02: dropping the same file twice never shows two identical names', async ({ page, owner, pdf }) => {
    await new LoginPage(page).loginAs(owner);
    const explorer = new ExplorerPage(page);
    const file = { name: 'NDA.pdf', mimeType: 'application/pdf', buffer: await pdf('NDA') };
    await explorer.upload([file]);
    await explorer.upload([file]);
    await expect(page.getByText('Uploads complete')).toBeVisible({ timeout: 30_000 });
    await page.reload();
    await expect.poll(() => explorer.rowNames()).toHaveLength(2);

    knownBug('BUG-02', 'two quick uploads of the same name both land as "NDA.pdf"');
    expect(await explorer.rowNames()).toEqual(['NDA (1).pdf', 'NDA.pdf']);
  });
});
