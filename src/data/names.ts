import { randomBytes } from 'node:crypto';
import { env } from '../config';

export function uniqueId(): string {
  return `${Date.now().toString(36)}${randomBytes(3).toString('hex')}`;
}

export function qaEmail(tag = 'user'): string {
  return `${env.emailPrefix}-${uniqueId()}-${tag}@example.com`.toLowerCase();
}
