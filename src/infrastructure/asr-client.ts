import { Transcript, TranscriptSegment } from '~/domain/types';

export interface ASRClient {
  transcribe(audioUrl: string, options?: { language?: string }): Promise<Transcript>;
}

export class MockASRClient implements ASRClient {
  async transcribe(audioUrl: string, options?: { language?: string }): Promise<Transcript> {
    await new Promise((r) => setTimeout(r, 500));

    const segments: TranscriptSegment[] = [
      { startMs: 0, endMs: 5000, text: '大家好，今天我们来讨论一个非常有意思的话题。' },
      { startMs: 5000, endMs: 12000, text: '关于短视频内容创作，很多人都有一些误解。' },
      { startMs: 12000, endMs: 20000, text: '首先，爆款视频不是靠运气，而是有方法论可循的。' },
      { startMs: 20000, endMs: 30000, text: '我们可以从选题、脚本、拍摄和剪辑四个维度来分析。' },
      { startMs: 30000, endMs: 45000, text: '选题阶段最重要的是找到用户真正的痛点和需求。' },
    ];

    return {
      id: 'mock-transcript',
      videoId: 'mock',
      workspaceId: 'default',
      source: 'asr',
      modelName: 'mock-asr-v1',
      language: options?.language || 'zh',
      segments,
      rawText: segments.map((s) => s.text).join('\n'),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }
}
