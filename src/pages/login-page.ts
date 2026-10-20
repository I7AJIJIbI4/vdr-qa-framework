import { expect, type Page } from '@playwright/test';

export class LoginPage {
  constructor(private readonly page: Page) {}

  async goto() {
    await this.page.goto('/login');
  }

  async login(email: string, password: string) {
    await this.page.getByLabel('Email').fill(email);
    await this.page.getByLabel('Password').fill(password);
    await this.page.getByRole('button', { name: /sign in|log in/i }).click();
  }

  /** Logs in through the UI and waits for the owner's room to load. */
  async loginAs(user: { email: string; password: string }) {
    await this.goto();
    await this.login(user.email, user.password);
    await expect(this.page).toHaveURL(/\/$/);
  }
}
