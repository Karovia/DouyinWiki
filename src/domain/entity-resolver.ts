import { eq, and } from 'drizzle-orm';
import { db } from '~/db';
import { graphNodes, entityAliases } from '~/db/schema';
import { ExtractedEntity, ResolvedEntity } from '~/domain/entity-types';
import { entityNodeId } from '~/domain/graph-ids';

export class EntityResolver {
  async resolveEntities(
    workspaceId: string,
    extracted: ExtractedEntity[]
  ): Promise<ResolvedEntity[]> {
    const resolved: ResolvedEntity[] = [];
    for (const entity of extracted) {
      const result = await this.resolveEntity(workspaceId, entity);
      resolved.push(result);
    }
    return resolved;
  }

  private async resolveEntity(
    workspaceId: string,
    entity: ExtractedEntity
  ): Promise<ResolvedEntity> {
    const normalized = this.normalizeText(entity.name);

    // Step 1: 查询别名表
    const aliasMatch = await db
      .select({ canonicalNodeId: entityAliases.canonicalNodeId })
      .from(entityAliases)
      .where(and(eq(entityAliases.workspaceId, workspaceId), eq(entityAliases.alias, normalized)))
      .limit(1);

    if (aliasMatch[0]) {
      const { businessId } = this.parseNodeIdQuick(aliasMatch[0].canonicalNodeId);
      return { name: entity.name, canonicalKey: businessId, type: entity.type, confidence: entity.confidence, isNew: false };
    }

    // Step 2: 查询已有实体节点
    const existing = await db
      .select({ id: graphNodes.id, canonicalKey: graphNodes.canonicalKey })
      .from(graphNodes)
      .where(
        and(
          eq(graphNodes.workspaceId, workspaceId),
          eq(graphNodes.nodeType, 'entity'),
          eq(graphNodes.canonicalKey, normalized)
        )
      )
      .limit(1);

    if (existing[0] && existing[0].canonicalKey) {
      return { name: entity.name, canonicalKey: existing[0].canonicalKey, type: entity.type, confidence: entity.confidence, isNew: false };
    }

    // Step 3: 新实体
    return { name: entity.name, canonicalKey: normalized, type: entity.type, confidence: entity.confidence, isNew: true };
  }

  private normalizeText(text: string): string {
    return text
      .normalize('NFKC')
      .trim()
      .toLowerCase()
      .replace(/[\s\-_\.]+/g, '');
  }

  private parseNodeIdQuick(nodeId: string): { type: string; businessId: string } {
    const [type, ...rest] = nodeId.split(':');
    return { type, businessId: rest.join(':') };
  }
}
