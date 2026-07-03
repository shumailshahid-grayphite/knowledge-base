import type { LlmCompletionInput, LlmCompletionResult, LlmProvider } from '@kb/shared';

/**
 * Deterministic answer generation for local dev and tests. Predictable output
 * derived from the provided context so retrieval/answer flow can be asserted
 * without a real model or API key.
 */
export class FakeLlmProvider implements LlmProvider {
  readonly model = 'fake-llm';

  complete(input: LlmCompletionInput): Promise<LlmCompletionResult> {
    // Use the provided context (system + user messages) to form a stable answer.
    const context = input.messages
      .filter((m) => m.role === 'system' || m.role === 'user')
      .map((m) => m.content)
      .join('\n')
      .replace(/\s+/g, ' ')
      .trim();

    const snippet = context.slice(0, 280);
    const text = context
      ? `[fake-llm] Based on the provided context: ${snippet}`
      : `[fake-llm] No context was provided.`;

    return Promise.resolve({
      text,
      model: this.model,
      usage: {
        promptTokens: estimateTokens(context),
        completionTokens: estimateTokens(text),
        totalTokens: estimateTokens(context) + estimateTokens(text),
      },
    });
  }
}

function estimateTokens(s: string): number {
  return Math.ceil(s.length / 4);
}
