// Типы эмбеддингов. БД/сеть не знают — чистые структуры.

export interface EmbedRequest {
  model: string;
  inputType: string;
  dims: number;
}

export interface EmbedResult {
  chunkId: string;
  vector: number[];
  hash: string;
  model: string;
  dims: number;
}

export interface EmbeddingRow {
  id: string;
  text: string;
  embeddingHash: string | null;
}

export interface EmbedRunOptions {
  type: string;
  apply: boolean;
  batchSize: number;
  limit?: number;
}