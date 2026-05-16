import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb, cleanTestDb } from '../helpers/db';
import { ImportService } from '../../src/services/import-service';
import { MockDouyinConnector } from '../../src/infrastructure/douyin-connector';
import type { DbClient } from '../../src/db';

describe('import-flow integration', () => {
  let testDb: DbClient;
  let importService: ImportService;

  beforeEach(async () => {
    testDb = await createTestDb();
    await cleanTestDb(testDb);
    const connector = new MockDouyinConnector();
    importService = new ImportService(connector, testDb);
  });

  describe('workspace isolation', () => {
    it('should isolate jobs between workspaces', async () => {
      const jobA = await importService.createImportJob(
        'https://www.douyin.com/video/123',
        'workspace-a'
      );
      const jobB = await importService.createImportJob(
        'https://www.douyin.com/video/123',
        'workspace-b'
      );

      expect(jobA.id).not.toBe(jobB.id);

      const listA = await importService.listJobs({ workspaceId: 'workspace-a' });
      expect(listA.items).toHaveLength(1);
      expect(listA.items[0].id).toBe(jobA.id);

      const listB = await importService.listJobs({ workspaceId: 'workspace-b' });
      expect(listB.items).toHaveLength(1);
      expect(listB.items[0].id).toBe(jobB.id);
    });

    it('should prevent cross-workspace job access', async () => {
      const job = await importService.createImportJob(
        'https://www.douyin.com/video/456',
        'workspace-a'
      );
      const status = await importService.getJobStatus(job.id, 'workspace-b');
      expect(status).toBeNull();
    });
  });

  describe('full import flow', () => {
    it('should complete full import flow', async () => {
      const job = await importService.createImportJob(
        'https://www.douyin.com/video/789',
        'default'
      );
      expect(job.status).toBe('created');

      await importService.updateJobStatus(job.id, 'default', 'parsing_metadata', {
        step: 'parsing_metadata',
      });
      await importService.updateJobStatus(job.id, 'default', 'fetching_content', {
        step: 'fetching_content',
      });
      await importService.updateJobStatus(job.id, 'default', 'transcribing', {
        step: 'transcribing',
      });
      await importService.updateJobStatus(job.id, 'default', 'chunking', {
        step: 'chunking',
      });
      await importService.updateJobStatus(job.id, 'default', 'summarizing', {
        step: 'summarizing',
        progress: 50,
      });
      await importService.updateJobStatus(job.id, 'default', 'embedding', {
        step: 'embedding',
      });
      await importService.updateJobStatus(job.id, 'default', 'indexing', {
        step: 'indexing',
      });
      await importService.updateJobStatus(job.id, 'default', 'graph_updating', {
        step: 'graph_updating',
      });
      await importService.updateJobStatus(job.id, 'default', 'completed', {
        step: 'completed',
        progress: 100,
      });

      const final = await importService.getJobStatus(job.id, 'default');
      expect(final?.status).toBe('completed');
      expect(final?.progress).toBe(100);
    });
  });

  describe('idempotency', () => {
    it('should be idempotent for same workspace and URL', async () => {
      const url = 'https://www.douyin.com/video/999';
      const job1 = await importService.createImportJob(url, 'default');
      const job2 = await importService.createImportJob(url, 'default');
      expect(job1.id).toBe(job2.id);
    });

    it('should allow same URL in different workspaces', async () => {
      const url = 'https://www.douyin.com/video/999';
      const job1 = await importService.createImportJob(url, 'workspace-x');
      const job2 = await importService.createImportJob(url, 'workspace-y');
      expect(job1.id).not.toBe(job2.id);
    });
  });

  describe('state machine validation', () => {
    it('should reject invalid state transitions', async () => {
      const job = await importService.createImportJob(
        'https://www.douyin.com/video/111',
        'default'
      );
      await expect(
        importService.updateJobStatus(job.id, 'default', 'completed')
      ).rejects.toThrow();
    });

    it('should reject transition from terminal state', async () => {
      const job = await importService.createImportJob(
        'https://www.douyin.com/video/222',
        'default'
      );
      await importService.updateJobStatus(job.id, 'default', 'parsing_metadata', {
        step: 'parsing_metadata',
      });
      await importService.updateJobStatus(job.id, 'default', 'fetching_content', {
        step: 'fetching_content',
      });
      await importService.updateJobStatus(job.id, 'default', 'transcribing', {
        step: 'transcribing',
      });
      await importService.updateJobStatus(job.id, 'default', 'chunking', {
        step: 'chunking',
      });
      await importService.updateJobStatus(job.id, 'default', 'summarizing', {
        step: 'summarizing',
      });
      await importService.updateJobStatus(job.id, 'default', 'embedding', {
        step: 'embedding',
      });
      await importService.updateJobStatus(job.id, 'default', 'indexing', {
        step: 'indexing',
      });
      await importService.updateJobStatus(job.id, 'default', 'graph_updating', {
        step: 'graph_updating',
      });
      await importService.updateJobStatus(job.id, 'default', 'completed', {
        step: 'completed',
      });
      await expect(
        importService.updateJobStatus(job.id, 'default', 'parsing_metadata')
      ).rejects.toThrow();
    });
  });

  describe('cancel and retry', () => {
    it('should cancel a job', async () => {
      const job = await importService.createImportJob(
        'https://www.douyin.com/video/333',
        'default'
      );
      await importService.updateJobStatus(job.id, 'default', 'parsing_metadata', {
        step: 'parsing_metadata',
      });
      const cancelled = await importService.cancelJob(job.id, 'default');
      expect(cancelled.status).toBe('cancelled');
      await expect(
        importService.updateJobStatus(job.id, 'default', 'summarizing')
      ).rejects.toThrow();
    });

    it('should retry a failed job', async () => {
      const job = await importService.createImportJob(
        'https://www.douyin.com/video/444',
        'default'
      );
      await importService.updateJobStatus(job.id, 'default', 'parsing_metadata', {
        step: 'parsing_metadata',
      });
      await importService.updateJobStatus(job.id, 'default', 'failed_retryable', {
        step: 'parsing_metadata',
        errorCode: 'PARSE_TIMEOUT',
        errorMessage: 'Timeout',
      });
      const retried = await importService.retryJob(job.id, 'default');
      expect(retried.status).toBe('parsing_metadata');
      expect(retried.retryCount).toBe(0);
    });
  });
});
