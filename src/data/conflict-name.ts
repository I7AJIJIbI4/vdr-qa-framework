/**
 * Test oracle for the product's file-name conflict rule (from the API docs):
 * a clash with an existing sibling, ignoring case, is resolved by appending
 * " (1)", " (2)", ... before the extension until the name is free.
 */
export function expectedConflictName(requested: string, existing: string[]): string {
  const taken = new Set(existing.map((n) => n.toLowerCase()));
  const dot = requested.lastIndexOf('.');
  const [base, ext] = dot > 0 ? [requested.slice(0, dot), requested.slice(dot)] : [requested, ''];

  let candidate = requested;
  for (let attempt = 1; taken.has(candidate.toLowerCase()); attempt++) {
    candidate = `${base} (${attempt})${ext}`;
  }
  return candidate;
}

/** Case-insensitive duplicates in a list of sibling names. */
export function findDuplicateNames(names: string[]): string[] {
  const seen = new Map<string, number>();
  for (const name of names) seen.set(name.toLowerCase(), (seen.get(name.toLowerCase()) ?? 0) + 1);
  return [...seen].filter(([, count]) => count > 1).map(([name]) => name);
}
