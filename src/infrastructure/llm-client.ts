export interface LLMClient {
  generateSummary(text: string): Promise<string>;
  generateTags(text: string): Promise<string[]>;
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
}
