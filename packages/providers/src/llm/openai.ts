import type { LlmCompletionInput, LlmCompletionResult, LlmProvider } from '@kb/shared';
import type { ProviderConfig } from '../config.js';

interface OpenAIChatResponse {
  choices: Array<{ message: { content: string | null } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
}

/** Real answer generation via OpenAI (or OpenAI-compatible) chat completions. */
export class OpenAiLlmProvider implements LlmProvider {
  readonly model: string;

  constructor(private readonly cfg: ProviderConfig) {
    if (!cfg.openaiApiKey) {
      throw new Error('OpenAiLlmProvider requires OPENAI_API_KEY');
    }
    this.model = cfg.llmModel;
  }

  async complete(input: LlmCompletionInput): Promise<LlmCompletionResult> {
    const res = await fetch(`${this.cfg.openaiBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.cfg.openaiApiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        messages: input.messages,
        temperature: input.temperature ?? 0.1,
        max_tokens: input.maxTokens,
      }),
    });
    if (!res.ok) {
      throw new Error(`OpenAI chat failed (${res.status}): ${await res.text()}`);
    }
    const json = (await res.json()) as OpenAIChatResponse;
    return {
      text: json.choices[0]?.message.content ?? '',
      model: this.model,
      usage: {
        promptTokens: json.usage?.prompt_tokens,
        completionTokens: json.usage?.completion_tokens,
        totalTokens: json.usage?.total_tokens,
      },
    };
  }
}
