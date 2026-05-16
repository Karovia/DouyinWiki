import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EntityResolver } from '../../src/domain/entity-resolver';
import { seedBuiltinAliases } from '../../src/db/seed-entity-aliases';
import { createTestDb, cleanTestDb, destroyTestDb } from '../helpers/db';
import { graphNodes, entityAliases } from '../../src/db/schema';
import { eq } from 'drizzle-orm';
import type { DbClient } from '../../src/db';

const workspaceId = 'test-ws-entity';

describe('entity-resolution', () => {
  let testDb: DbClient;

  beforeEach(async () => {
    testDb = await createTestDb();
  });

  afterEach(() => {
    destroyTestDb(testDb);
  });

  it('should resolve new entity', async () => {
    const resolver = new EntityResolver();
    const result = await resolver.resolveEntities(workspaceId, [
      { name: 'Rust', originalText: 'Rust', type: 'technology', confidence: 0.9 },
    ]);
    expect(result[0].canonicalKey).toBe('rust');
    expect(result[0].isNew).toBe(true);
  });

  it('should resolve builtin alias', async () => {
    await seedBuiltinAliases(workspaceId);
    const resolver = new EntityResolver();
    const result = await resolver.resolveEntities(workspaceId, [
      { name: 'ReactJS', originalText: 'ReactJS', type: 'technology', confidence: 0.9 },
    ]);
    expect(result[0].canonicalKey).toBe('React');
    expect(result[0].isNew).toBe(false);
  });
});
