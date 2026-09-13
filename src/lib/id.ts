/**
 * UUID generation for row identifiers.
 *
 * Ids are minted on-device and used verbatim as primary keys in Postgres, so
 * they must be valid UUIDs — that is what lets sync upsert by id instead of
 * maintaining a local-id → remote-id mapping table.
 *
 * `crypto.randomUUID` is used when the runtime has it. The fallback is
 * `Math.random`, which is fine here: these identify rows inside one user's own
 * ledger, they are never secrets, and a collision would need two draws from
 * 122 bits within a single account.
 */
export function uuid(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  if (typeof g.crypto?.randomUUID === 'function') return g.crypto.randomUUID();

  const hex: string[] = [];
  for (let i = 0; i < 256; i++) hex[i] = (i + 0x100).toString(16).slice(1);

  const b = new Array<number>(16);
  for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);

  // Version 4, variant 10xx — required for Postgres to accept it as a uuid.
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;

  return (
    hex[b[0]!]! + hex[b[1]!]! + hex[b[2]!]! + hex[b[3]!]! + '-' +
    hex[b[4]!]! + hex[b[5]!]! + '-' +
    hex[b[6]!]! + hex[b[7]!]! + '-' +
    hex[b[8]!]! + hex[b[9]!]! + '-' +
    hex[b[10]!]! + hex[b[11]!]! + hex[b[12]!]! + hex[b[13]!]! + hex[b[14]!]! + hex[b[15]!]!
  );
}

/** True for a canonical v4 UUID — used to skip legacy ids during sync. */
export function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
}
