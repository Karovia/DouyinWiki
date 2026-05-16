import { z } from 'zod';
import { router, authedProcedure } from '../trpc';
import { WorkspaceService } from '~/services/workspace-service';

const workspaceService = new WorkspaceService();

export const workspaceRouter = router({
  create: authedProcedure
    .input(z.object({ name: z.string().min(1).max(50), slug: z.string().min(1).max(30) }))
    .mutation(async ({ input, ctx }) => {
      return workspaceService.createWorkspace({
        name: input.name,
        slug: input.slug,
        ownerId: ctx.userId,
      });
    }),

  list: authedProcedure
    .query(async ({ ctx }) => {
      return workspaceService.listUserWorkspaces(ctx.userId);
    }),

  addMember: authedProcedure
    .input(z.object({
      workspaceId: z.string(),
      userId: z.string(),
      role: z.enum(['admin', 'member']).default('member'),
    }))
    .mutation(async ({ input, ctx }) => {
      const hasPerm = await workspaceService.hasPermission(input.workspaceId, ctx.userId, 'admin');
      if (!hasPerm) throw new Error('Permission denied');
      await workspaceService.addMember(input.workspaceId, input.userId, input.role, ctx.userId);
      return { success: true };
    }),
});
