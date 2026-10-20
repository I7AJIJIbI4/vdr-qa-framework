import { expect, type Locator, type Page } from '@playwright/test';

export class ShareDialog {
  readonly root: Locator;

  constructor(private readonly page: Page) {
    this.root = page.getByRole('dialog');
  }

  async openFromToolbar() {
    await this.page.getByRole('button', { name: 'Share' }).first().click();
    await expect(this.root.getByText('Public link', { exact: true })).toBeVisible();
  }

  /** Creates the public link if needed and returns its URL. */
  async ensurePublicLink(): Promise<string> {
    const linkInput = this.root.locator('input[readonly]');
    if (!(await linkInput.isVisible())) {
      await this.root.getByRole('button', { name: 'Create public link' }).click();
    }
    await expect(linkInput).toBeVisible();
    return linkInput.inputValue();
  }

  async revokePublicLink() {
    await this.root.getByRole('button', { name: /revoke public link/i }).click();
    await expect(this.root.locator('input[readonly]')).toBeHidden();
  }

  async shareWith(email: string) {
    await this.root.getByLabel('Email').fill(email);
    await this.root.getByRole('button', { name: 'Share', exact: true }).click();
    await expect(this.root.getByText(email.toLowerCase(), { exact: true })).toBeVisible();
  }

  async revokePerson(email: string) {
    await this.root.locator('li', { hasText: email }).getByRole('button', { name: 'Revoke' }).click();
    await expect(this.root.getByText(email, { exact: true })).toBeHidden();
  }

  async close() {
    await this.root.getByRole('button', { name: 'Done' }).click();
  }
}
