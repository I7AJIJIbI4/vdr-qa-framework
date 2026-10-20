import { expect, type Locator, type Page } from '@playwright/test';

/** The folder/room browser: toolbar, contents table, row menus, dialogs, upload panel. */
export class ExplorerPage {
  readonly main: Locator;
  readonly rows: Locator;
  readonly dialog: Locator;

  constructor(private readonly page: Page) {
    this.main = page.locator('main');
    this.rows = page.locator('table tbody tr');
    this.dialog = page.getByRole('dialog');
  }

  row(name: string): Locator {
    return this.rows.filter({ has: this.page.getByText(name, { exact: true }) });
  }

  async rowNames(): Promise<string[]> {
    const texts = await this.rows.allInnerTexts();
    return texts.map((t) => t.split(/\n|\t/)[0].trim()).filter(Boolean);
  }

  async createFolder(name: string) {
    await this.page.getByRole('button', { name: 'New folder' }).first().click();
    await this.dialog.getByLabel('Folder name').fill(name);
    await this.page.keyboard.press('Enter');
  }

  async open(name: string) {
    await this.row(name).getByText(name, { exact: true }).click();
  }

  async rowAction(name: string, action: 'Rename' | 'Move' | 'Download' | 'Share' | 'Delete') {
    await this.row(name).getByRole('button').last().click();
    await this.page.getByRole('menuitem', { name: action }).click();
  }

  async upload(files: string[] | { name: string; mimeType: string; buffer: Buffer }[]) {
    await this.page.locator('input[type=file]').setInputFiles(files);
  }

  async expectRow(name: string) {
    await expect(this.row(name)).toBeVisible();
  }

  breadcrumb(): Locator {
    return this.page.getByRole('navigation', { name: 'Breadcrumb' });
  }

  toast(text: string | RegExp): Locator {
    return this.page.locator('[data-sonner-toast]').filter({ hasText: text });
  }
}
