import { db } from '~/db';
import { graphNodes, entityAliases } from '~/db/schema';
import { entityNodeId } from '~/domain/graph-ids';
import { nanoid } from 'nanoid';

const BUILTIN_ALIASES: Record<string, string[]> = {
  'React': ['React.js', 'ReactJS', 'reactjs', 'React 18', 'React 19'],
  'TypeScript': ['TS', 'typescript', 'Type Script'],
  'Vue': ['Vue.js', 'VueJS', 'vuejs', 'Vue 3'],
  'Next.js': ['NextJS', 'nextjs'],
  'Node.js': ['NodeJS', 'nodejs', 'Node'],
  'Docker': ['docker'],
  'Kubernetes': ['K8s', 'k8s', 'kube'],
  'GitHub': ['Github', 'github'],
  '抖音': ['Douyin', 'TikTok', 'douyin'],
};

export async function seedBuiltinAliases(workspaceId: string): Promise<void> {
  for (const [canonical, aliases] of Object.entries(BUILTIN_ALIASES)) {
    const canonicalNodeId = entityNodeId(canonical);

    await db.insert(graphNodes).values({
      id: canonicalNodeId,
      workspaceId,
      nodeType: 'entity',
      businessId: canonical,
      canonicalKey: canonical,
      label: canonical,
    }).onConflictDoNothing();

    for (const alias of aliases) {
      const normalizedAlias = alias.toLowerCase().replace(/[\s\-_\.]+/g, '');
      await db.insert(entityAliases).values({
        id: nanoid(),
        workspaceId,
        alias: normalizedAlias,
        canonicalNodeId,
        source: 'builtin',
      }).onConflictDoNothing();
    }
  }
}
