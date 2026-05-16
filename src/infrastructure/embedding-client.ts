import { AppError } from '~/domain/errors';

export interface EmbeddingClient {
  embed(texts: string[]): Promise<number[][]>;
  getDimension(): number;
}

export class MockEmbeddingClient implements EmbeddingClient {
  private dimension = 384;

  getDimension(): number {
    return this.dimension;
  }

  async embed(texts: string[]): Promise<number[][]> {
    await new Promise((r) => setTimeout(r, 100));

    return texts.map((text) => {
      const vec = new Array(this.dimension).fill(0);
      for (let i = 0; i < this.dimension; i++) {
        let hash = 0;
        for (let j = 0; j < text.length; j++) {
          hash = ((hash << 5) - hash + text.charCodeAt(j) + i * 31) | 0;
        }
        vec[i] = (hash % 1000) / 1000;
      }
      const norm = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0));
      return norm > 0 ? vec.map((v) => v / norm) : vec;
    });
  }
}
