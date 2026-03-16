// OpenAI API client for prompt improvement

export class OpenAIClient {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.baseUrl = 'https://api.openai.com/v1';
    this.model = 'gpt-4o-mini';
  }

  setApiKey(key) {
    this.apiKey = key;
  }

  async improvePrompt(originalPrompt, memoryContext) {
    if (!this.apiKey) {
      console.warn('OpenAI: No API key, returning original prompt');
      return originalPrompt;
    }

    const systemPrompt = this.buildSystemPrompt(memoryContext);

    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: `Original prompt:\n${originalPrompt}` }
          ],
          max_tokens: 2048,
          temperature: 0.7
        })
      });

      if (!response.ok) {
        const error = await response.json();
        console.error('OpenAI API error:', error);
        return originalPrompt;
      }

      const data = await response.json();
      return data.choices[0].message.content.trim();
    } catch (error) {
      console.error('OpenAI: Failed to improve prompt:', error);
      return originalPrompt;
    }
  }

  buildSystemPrompt(memoryContext) {
    let prompt = `You are an expert prompt engineer. Improve the user's prompt to be clearer, more specific, and more likely to get a helpful response.

IMPORTANT: Return ONLY the improved prompt. No explanations, no quotes, no prefixes.`;

    if (memoryContext.memories !== 'No memories yet.') {
      prompt += `\n\nUser's patterns and preferences:\n${memoryContext.memories}`;
    }

    if (memoryContext.recentTopics !== 'No recent topics.') {
      prompt += `\n\nRecent topics:\n- ${memoryContext.recentTopics}`;
    }

    return prompt;
  }

  async distillMemories(conversations) {
    if (!this.apiKey || conversations.length === 0) {
      return null;
    }

    const systemPrompt = `Analyze these conversation prompts and extract key patterns.
Create a 2-3 sentence summary of the user's interests, style, and focus areas.`;

    const conversationText = conversations
      .map((c, i) => `${i + 1}. ${c.prompt}`)
      .join('\n');

    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: conversationText }
          ],
          max_tokens: 500,
          temperature: 0.5
        })
      });

      if (!response.ok) {
        console.error('OpenAI: Distillation API error');
        return null;
      }

      const data = await response.json();
      return data.choices[0].message.content.trim();
    } catch (error) {
      console.error('OpenAI: Failed to distill memories:', error);
      return null;
    }
  }
}
