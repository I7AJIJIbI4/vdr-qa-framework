/** Target environment. Defaults point at the public deployment from the product README. */
export const env = {
  webUrl: process.env.WEB_URL ?? 'https://virtual-data-room-ten.vercel.app',
  apiUrl: process.env.API_URL ?? 'https://virtual-data-room-production.up.railway.app',
  /** Every account the suite creates uses this password. */
  password: process.env.QA_PASSWORD ?? 'Passw0rd!qa',
  /** Prefix for generated emails, so test data is recognizable and purgeable. */
  emailPrefix: process.env.QA_EMAIL_PREFIX ?? 'qa-auto',
} as const;
