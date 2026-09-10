export const PACKAGE_VERSION = 1;
export function readPackage(value: unknown): { version: 1; name: string; source: string; code: string } {
  const p = value as Record<string, unknown>;
  if (!p || p.version !== PACKAGE_VERSION || typeof p.name !== 'string' || p.name.length > 100 || typeof p.source !== 'string' || typeof p.code !== 'string' || p.source.length > 100_000 || p.code.length > 2_000_000) throw new Error('Invalid Orbit package. Expected a version 1 program under 2 MB.');
  return p as ReturnType<typeof readPackage>;
}
