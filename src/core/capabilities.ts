export const CAPABILITIES = ['web.read', 'repo.read', 'db.stats', 'repo.write'] as const;
export type Capability = (typeof CAPABILITIES)[number];

const allowed = new Set<string>(CAPABILITIES);
const trusted = new Set<Capability>(['repo.read', 'db.stats']);

export function normalizeCapabilities(value: unknown): Capability[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value.filter((item): item is Capability => typeof item === 'string' && allowed.has(item)),
    ),
  ];
}

export function requiresTrustedChannel(capabilities: Capability[]): boolean {
  return capabilities.some(
    (capability) =>
      trusted.has(capability) &&
      !(capability === 'repo.read' && capabilities.includes('repo.write')),
  );
}
