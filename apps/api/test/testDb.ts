/** Integration tests run in a separate Postgres schema so they never touch dev data. */
export function testDatabaseUrl(): string | null {
  const base = process.env.DATABASE_URL;
  if (!base) return null;
  const url = new URL(base);
  url.searchParams.set('schema', 'extract_test');
  return url.toString();
}
