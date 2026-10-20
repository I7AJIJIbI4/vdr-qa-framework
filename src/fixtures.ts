import { test as base, expect, request as playwrightRequest, type APIRequestContext } from '@playwright/test';
import { env } from './config';
import { must, VdrApi } from './api/client';
import { qaEmail } from './data/names';
import { makePdf } from './data/pdf';

export interface Actor {
  email: string;
  name: string;
  password: string;
  token: string;
  /** The default data room created at registration. */
  roomId: string;
  api: VdrApi;
}

interface Fixtures {
  /** Unauthenticated client against the API. */
  anon: VdrApi;
  /** Registers a brand-new user (with an empty room). Cleaned up after the test. */
  newActor: (tag?: string) => Promise<Actor>;
  /** Convenience: a fresh owner and a fresh unrelated user. */
  owner: Actor;
  stranger: Actor;
  /** Cached valid PDF bytes. */
  pdf: (title?: string) => Promise<Buffer>;
}

interface WorkerFixtures {
  apiContext: APIRequestContext;
}

/**
 * Each test gets its own users, so tests never share state and can run in
 * parallel against a shared environment. There is no user-deletion endpoint,
 * so teardown empties each room instead; accounts are identifiable by the
 * `qa-auto-` email prefix for an out-of-band purge.
 */
export const test = base.extend<Fixtures, WorkerFixtures>({
  apiContext: [
    async ({}, use) => {
      const context = await playwrightRequest.newContext({ baseURL: env.apiUrl });
      await use(context);
      await context.dispose();
    },
    { scope: 'worker' },
  ],

  anon: async ({ apiContext }, use) => {
    await use(new VdrApi(apiContext));
  },

  newActor: async ({ apiContext }, use) => {
    const created: Actor[] = [];
    await use(async (tag = 'user') => {
      const anon = new VdrApi(apiContext);
      const email = qaEmail(tag);
      const name = `QA ${tag}`;
      const { accessToken } = must(await anon.register({ name, email, password: env.password }));
      const api = anon.as(accessToken);
      const roomId = must(await api.listDataRooms()).items[0].id;
      const actor = { email, name, password: env.password, token: accessToken, roomId, api };
      created.push(actor);
      return actor;
    });
    for (const actor of created) await emptyRoom(actor);
  },

  owner: async ({ newActor }, use) => {
    await use(await newActor('owner'));
  },

  stranger: async ({ newActor }, use) => {
    await use(await newActor('stranger'));
  },

  pdf: async ({}, use) => {
    const cache = new Map<string, Buffer>();
    await use(async (title = 'QA document') => {
      if (!cache.has(title)) cache.set(title, await makePdf(title));
      return cache.get(title)!;
    });
  },
});

async function emptyRoom(actor: Actor): Promise<void> {
  try {
    const items = await actor.api.collectAll((q) => actor.api.roomContents(actor.roomId, q));
    for (const item of items) {
      if (item.type === 'folder') await actor.api.deleteFolder(item.id);
      else await actor.api.deleteFile(item.id);
    }
  } catch {
    // Cleanup is best effort - never fail a test because teardown hiccuped.
  }
}

/**
 * Marks a test as documenting a known, still-open defect. The test asserts
 * the CORRECT behaviour and is expected to fail; once the bug is fixed
 * Playwright reports "expected to fail, but passed", prompting removal.
 *
 * Call it only AFTER all setup: from this point any failure counts as the
 * expected one, so setup that runs earlier must fail the test for real.
 */
export function knownBug(id: string, summary: string) {
  test.info().annotations.push({ type: 'known-bug', description: `${id}: ${summary}` });
  test.fail(true, `${id} is open`);
}

export { expect };
