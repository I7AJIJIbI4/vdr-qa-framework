import { env } from '../../src/config';
import { qaEmail } from '../../src/data/names';
import { expect, knownBug, test } from '../../src/fixtures';

test.describe('Auth', () => {
  test('register returns a token and creates an empty default room @smoke', async ({ anon }) => {
    const email = qaEmail('reg');
    const res = await anon.register({ name: 'QA Reg', email, password: env.password });
    expect(res.status).toBe(201);

    const me = anon.as(res.body.accessToken);
    expect((await me.me()).body).toMatchObject({ email, name: 'QA Reg' });
    const rooms = (await me.listDataRooms()).body.items;
    expect(rooms).toHaveLength(1);
    expect((await me.roomContents(rooms[0].id)).body.items).toEqual([]);
  });

  test('email is unique case-insensitively and login ignores case', async ({ anon, owner }) => {
    const dup = await anon.register({ name: 'x', email: owner.email.toUpperCase(), password: env.password });
    expect(dup.status).toBe(409);
    const login = await anon.login({ email: owner.email.toUpperCase(), password: owner.password });
    expect(login.status).toBe(200);
  });

  test('wrong password and unknown user give the same 401 (no account enumeration)', async ({ anon, owner }) => {
    const wrong = await anon.login({ email: owner.email, password: 'nope-nope' });
    const unknown = await anon.login({ email: qaEmail('ghost'), password: 'nope-nope' });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body).toEqual(unknown.body);
  });

  test('register validation', async ({ anon }) => {
    const base = { name: 'QA', email: qaEmail('val'), password: env.password };
    expect((await anon.register({ ...base, password: '1234567' })).status).toBe(400);
    expect((await anon.register({ ...base, email: 'not-an-email' })).status).toBe(400);
    expect((await anon.register({ ...base, name: '' })).status).toBe(400);
  });

  test('protected endpoints reject missing, garbage and forged tokens @security', async ({ anon, owner }) => {
    const [header, payload, signature] = owner.token.split('.');
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString());
    const forged = `${header}.${Buffer.from(JSON.stringify({ ...claims, sub: 'someone-else' })).toString('base64url')}.${signature}`;
    const algNone = `${Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')}.${payload}.`;

    for (const token of [undefined, 'garbage', forged, algNone]) {
      expect((await anon.as(token).me()).status, `token=${token?.slice(0, 12)}`).toBe(401);
    }
  });

  test('BUG-07: whitespace-only name is rejected', async ({ anon }) => {
    const res = await anon.register({ name: '   ', email: qaEmail('ws'), password: env.password });
    expect(res.status, 'must not be a server error').toBeLessThan(500);

    knownBug('BUG-07', 'API trims the name after validation and stores an empty string');
    expect(res.status).toBe(400);
  });

  test('BUG-04: repeated failed logins are throttled @security', async ({ anon, owner }) => {
    const statuses: number[] = [];
    for (let i = 0; i < 15; i++) statuses.push((await anon.login({ email: owner.email, password: `bad-${i}` })).status);
    expect(statuses.every((s) => s === 401 || s === 429), `unexpected statuses: ${statuses}`).toBe(true);

    knownBug('BUG-04', 'no rate limiting or lockout on /auth/login');
    expect(statuses).toContain(429);
  });
});
