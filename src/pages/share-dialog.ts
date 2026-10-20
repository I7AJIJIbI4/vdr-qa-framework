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
    const createButton = this.root.getByRole('button', { name: 'Create public link' });
    // Wait until the dialog has decided which of the two states it is in.
    await expect(linkInput.or(createButton)).toBeVisible();
    if (await createButton.isVisible()) await createButton.click();
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
    const stored = email.toLowerCase();
    await this.root.locator('li', { hasText: stored }).getByRole('button', { name: 'Revoke' }).click();
    await expect(this.root.getByText(stored, { exact: true })).toBeHidden();
  }

  async close() {
    await this.root.getByRole('button', { name: 'Done' }).click();
  }
}
