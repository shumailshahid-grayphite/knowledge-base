/**
 * LLM provider abstraction for grounded answer generation. Keep provider-specific
 * logic (OpenAI/Anthropic) behind this so the answering service stays neutral.
 */

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LlmCompletionInput {
  messages: LlmMessage[];
  temperature?: number;
  maxTokens?: number;
}

export interface LlmTokenUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export interface LlmCompletionResult {
  text: string;
  model: string;
  usage?: LlmTokenUsage;
}

export interface LlmProvider {
  readonly model: string;
  complete(input: LlmCompletionInput): Promise<LlmCompletionResult>;
}
