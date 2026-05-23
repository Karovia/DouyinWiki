import { router } from './trpc';
import { importRouter } from './import-router';
import { videosRouter } from './videos-router';
import { qaRouter } from './qa-router';
import { mtaRouter } from './mta-router';
import { settingsRouter } from './settings-router';

export const appRouter = router({
  import: importRouter,
  videos: videosRouter,
  qa: qaRouter,
  mta: mtaRouter,
  settings: settingsRouter,
});

export type AppRouter = typeof appRouter;
