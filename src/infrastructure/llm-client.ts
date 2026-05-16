import { ExtractedEntity } from '~/domain/entity-types';

export interface LLMClient {
  generateSummary(text: string): Promise<string>;
  generateTags(text: string): Promise<string[]>;
  analyzeContent(input: {
    title: string;
    transcript: string;
  }): Promise<{
    summary: string;
    tags: string[];
    entities: ExtractedEntity[];
  }>;
}

// Mock 实现（Phase 1 使用）
export class MockLLMClient implements LLMClient {
  async generateSummary(text: string): Promise<string> {
    await new Promise((r) => setTimeout(r, 300));
    return `AI 摘要：这是一段关于「${text.slice(0, 20)}...」的视频内容。主要讨论了相关主题的核心观点。`;
  }

  async generateTags(text: string): Promise<string[]> {
    await new Promise((r) => setTimeout(r, 100));
    const keywords = text.match(/[一-鿿]{2,4}/g) || [];
    return [...new Set(keywords)].slice(0, 5).length > 0
      ? [...new Set(keywords)].slice(0, 5)
      : ['默认标签', '测试'];
  }

  async analyzeContent(input: {
    title: string;
    transcript: string;
  }): Promise<{
    summary: string;
    tags: string[];
    entities: ExtractedEntity[];
  }> {
    await new Promise((r) => setTimeout(r, 300));
    const text = `${input.title}\n${input.transcript}`;
    const summary = await this.generateSummary(text);
    const tags = await this.generateTags(text);
    const mockEntities: ExtractedEntity[] = [
      { name: 'React', originalText: 'React', type: 'technology', confidence: 0.92 },
      { name: 'TypeScript', originalText: 'TypeScript', type: 'technology', confidence: 0.88 },
    ];
    return { summary, tags, entities: mockEntities };
  }
}
