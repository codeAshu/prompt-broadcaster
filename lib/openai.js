// OpenAI API client for prompt improvement

class OpenAIClient {
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
      console.warn('No API key set, returning original prompt');
      return originalPrompt;
    }

    const systemPrompt = `You are an expert prompt engineer. Your job is to improve user prompts to get better responses from AI assistants.

Given the user's original prompt and their conversation history/preferences, improve the prompt to be:
- Clearer and more specific
- Better structured
- More likely to get a helpful, detailed response

${memoryContext.memories !== 'No memories yet.' ? `
User's Memory Context (their patterns and preferences):
${memoryContext.memories}
` : ''}

${memoryContext.recentTopics !== 'No recent topics.' ? `
Recent topics they've asked about:
- ${memoryContext.recentTopics}
` : ''}

IMPORTANT: Return ONLY the improved prompt. Do not add explanations, do not wrap in quotes, do not prefix with anything. Just output the improved prompt text directly.`;

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
      console.error('Failed to improve prompt:', error);
      return originalPrompt;
    }
  }

  async distillMemories(conversations) {
    if (!this.apiKey || conversations.length === 0) {
      return null;
    }

    const systemPrompt = `You are a memory distillation system. Analyze the following conversation prompts and extract key patterns, preferences, and topics.

Create a concise summary that captures:
- Common themes and interests
- Communication style preferences
- Technical areas of focus
- Any recurring patterns

Output a brief paragraph (2-3 sentences) that summarizes what you've learned about this user.`;

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
        console.error('OpenAI API error during distillation');
        return null;
      }

      const data = await response.json();
      return data.choices[0].message.content.trim();
    } catch (error) {
      console.error('Failed to distill memories:', error);
      return null;
    }
  }
}

// Export for use in service worker
if (typeof globalThis !== 'undefined') {
  globalThis.OpenAIClient = OpenAIClient;
}
