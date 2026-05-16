import { eq, and } from 'drizzle-orm';
import { db } from '~/db';
import { workspaces, workspaceMembers } from '~/db/schema';
import { Workspace, WorkspaceRole } from '~/domain/workspace-types';
import { nanoid } from 'nanoid';

export class WorkspaceService {
  async createWorkspace(params: {
    name: string;
    slug: string;
    ownerId: string;
  }): Promise<Workspace> {
    const id = nanoid();
    await db.insert(workspaces).values({
      id,
      name: params.name,
      slug: params.slug,
      ownerId: params.ownerId,
    });

    await db.insert(workspaceMembers).values({
      id: nanoid(),
      workspaceId: id,
      userId: params.ownerId,
      role: 'owner',
    });

    const result = await db.select().from(workspaces).where(eq(workspaces.id, id)).limit(1);
    return result[0] as Workspace;
  }

  async getWorkspace(workspaceId: string): Promise<Workspace | null> {
    const result = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1);
    return (result[0] as Workspace) || null;
  }

  async listUserWorkspaces(userId: string): Promise<Workspace[]> {
    const memberRows = await db
      .select({ workspaceId: workspaceMembers.workspaceId })
      .from(workspaceMembers)
      .where(eq(workspaceMembers.userId, userId));

    const workspaceIds = memberRows.map((m) => m.workspaceId);
    if (workspaceIds.length === 0) return [];

    // 简化：一次查一个
    const results: Workspace[] = [];
    for (const wid of workspaceIds) {
      const row = await db.select().from(workspaces).where(eq(workspaces.id, wid)).limit(1);
      if (row[0]) results.push(row[0] as Workspace);
    }
    return results;
  }

  async addMember(workspaceId: string, userId: string, role: WorkspaceRole, invitedBy: string): Promise<void> {
    await db.insert(workspaceMembers).values({
      id: nanoid(),
      workspaceId,
      userId,
      role,
      invitedBy,
    }).onConflictDoNothing();
  }

  async removeMember(workspaceId: string, userId: string): Promise<void> {
    await db.delete(workspaceMembers).where(
      and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId))
    );
  }

  async getMemberRole(workspaceId: string, userId: string): Promise<WorkspaceRole | null> {
    const result = await db
      .select({ role: workspaceMembers.role })
      .from(workspaceMembers)
      .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)))
      .limit(1);
    return (result[0]?.role as WorkspaceRole) || null;
  }

  async hasPermission(workspaceId: string, userId: string, requiredRole: WorkspaceRole): Promise<boolean> {
    const role = await this.getMemberRole(workspaceId, userId);
    if (!role) return false;
    const hierarchy: Record<WorkspaceRole, number> = { owner: 3, admin: 2, member: 1 };
    return hierarchy[role] >= hierarchy[requiredRole];
  }
}
