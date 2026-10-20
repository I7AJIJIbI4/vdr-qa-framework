import { expect, test } from '@playwright/test';
import { expectedConflictName, findDuplicateNames } from '../../src/data/conflict-name';
import { isPdf, makePdf } from '../../src/data/pdf';
import { qaEmail, uniqueId } from '../../src/data/names';

// The API/E2E layers trust these helpers as oracles, so they get their own fast checks.

test.describe('expectedConflictName', () => {
  const cases: [string, string[], string][] = [
    ['nda.pdf', [], 'nda.pdf'],
    ['nda.pdf', ['nda.pdf'], 'nda (1).pdf'],
    ['NDA.PDF', ['nda.pdf'], 'NDA (1).PDF'],
    ['nda.pdf', ['nda.pdf', 'NDA (1).pdf'], 'nda (2).pdf'],
    ['report', ['report'], 'report (1)'],
    ['.env', ['.env'], '.env (1)'],
    ['a.b.pdf', ['a.b.pdf'], 'a.b (1).pdf'],
  ];
  for (const [requested, existing, expected] of cases) {
    test(`${requested} with [${existing.join(', ')}] -> ${expected}`, () => {
      expect(expectedConflictName(requested, existing)).toBe(expected);
    });
  }
});

test('findDuplicateNames is case-insensitive', () => {
  expect(findDuplicateNames(['A.pdf', 'b.pdf', 'a.PDF'])).toEqual(['a.pdf']);
  expect(findDuplicateNames(['a.pdf', 'b.pdf'])).toEqual([]);
});

test('makePdf produces a parseable PDF', async () => {
  const bytes = await makePdf('Unit');
  expect(isPdf(bytes)).toBe(true);
  expect(bytes.length).toBeGreaterThan(300);
});

test('generated identities are unique and recognizable', () => {
  const ids = new Set(Array.from({ length: 200 }, uniqueId));
  expect(ids.size).toBe(200);
  expect(qaEmail('owner')).toMatch(/^qa-auto-[a-z0-9]+-owner@example\.com$/);
});
