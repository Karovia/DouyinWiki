import { router } from './trpc';
import { importRouter } from './import-router';
import { videosRouter } from './videos-router';
import { qaRouter } from './qa-router';
import { mtaRouter } from './mta-router';

export const appRouter = router({
  import: importRouter,
  videos: videosRouter,
  qa: qaRouter,
  mta: mtaRouter,
});

export type AppRouter = typeof appRouter;
