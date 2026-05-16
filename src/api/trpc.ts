import { initTRPC, TRPCError } from '@trpc/server';
import { AppError } from '../domain/errors';

export interface TrpcContext {
  workspaceId: string;
  userId: string;
}

function mapStatusToTrpcCode(statusCode: number): TRPCError['code'] {
  if (statusCode === 400) return 'BAD_REQUEST';
  if (statusCode === 401) return 'UNAUTHORIZED';
  if (statusCode === 403) return 'FORBIDDEN';
  if (statusCode === 404) return 'NOT_FOUND';
  if (statusCode === 409) return 'CONFLICT';
  if (statusCode === 422) return 'UNPROCESSABLE_CONTENT';
  if (statusCode === 429) return 'TOO_MANY_REQUESTS';
  if (statusCode === 504) return 'TIMEOUT';
  return 'INTERNAL_SERVER_ERROR';
}

export function throwTrpcError(err: unknown): never {
  if (err instanceof AppError) {
    throw new TRPCError({
      code: mapStatusToTrpcCode(err.statusCode),
      message: err.message,
      cause: err,
    });
  }
  throw err;
}

const t = initTRPC.context<TrpcContext>().create({
  errorFormatter({ shape, error }) {
    const cause = error.cause;
    if (cause instanceof AppError) {
      return {
        ...shape,
        data: {
          ...shape.data,
          code: cause.code,
          retryable: cause.retryable,
        },
      };
    }
    return shape;
  },
});

export const router = t.router;
export const publicProcedure = t.procedure;

// Workspace 校验中间件
export const authedProcedure = t.procedure.use(
  t.middleware(async ({ ctx, next }) => {
    // Phase 1 简化：默认 workspace
    return next({
      ctx: {
        ...ctx,
        workspaceId: ctx.workspaceId || 'default',
        userId: ctx.userId || 'anonymous',
      },
    });
  })
);
