// Background service worker for Prompt Broadcaster

import { MemorySystem } from './lib/memory.js';
import { OpenAIClient } from './lib/openai.js';

class PromptBroadcaster {
  constructor() {
    this.memorySystem = null;
    this.openaiClient = null;
    this.isEnabled = true;
    this.isInitialized = false;
    this.initPromise = this.initialize();
  }

  async initialize() {
    try {
      console.log('PromptBroadcaster: Initializing...');

      this.memorySystem = new MemorySystem();
      await this.memorySystem.init();

      const stored = await chrome.storage.local.get(['openaiApiKey', 'isEnabled']);
      this.openaiClient = new OpenAIClient(stored.openaiApiKey || '');
      this.isEnabled = stored.isEnabled !== false;
      this.isInitialized = true;

      console.log('PromptBroadcaster: Ready', {
        hasApiKey: !!stored.openaiApiKey,
        isEnabled: this.isEnabled
      });
    } catch (error) {
      console.error('PromptBroadcaster: Init failed', error);
      this.openaiClient = new OpenAIClient('');
    }
  }

  async ensureReady() {
    await this.initPromise;
    return this.isInitialized;
  }

  async handleMessage(message, sender) {
    await this.ensureReady();

    const handlers = {
      'BROADCAST_PROMPT': () => this.broadcast(message.prompt),
      'BROADCAST_SPLIT': () => this.broadcastSplit(message.prompt, message.layout),
      'GET_PENDING_PROMPT': () => this.getPendingPrompt(),
      'CLEAR_PENDING_PROMPT': () => this.clearPendingPrompt(),
      'SET_API_KEY': () => this.setApiKey(message.apiKey),
      'SET_ENABLED': () => this.setEnabled(message.enabled),
      'GET_STATUS': () => this.getStatus(),
      'GET_MEMORIES': () => this.getMemories(),
      'GET_CONVERSATIONS': () => this.getConversations(),
      'CLEAR_MEMORY': () => this.clearMemory(),
      'IMPORT_MEMORY': () => this.importMemory(message.data)
    };

    const handler = handlers[message.type];
    if (!handler) {
      console.warn('Unknown message:', message.type);
      return { error: 'Unknown message type' };
    }

    return handler();
  }

  async broadcast(originalPrompt) {
    if (!this.isEnabled) {
      return { improved: originalPrompt, broadcasted: false };
    }

    try {
      const improvedPrompt = await this.improveAndSave(originalPrompt);
      await chrome.storage.local.set({ pendingPrompt: improvedPrompt });

      await Promise.all([
        chrome.tabs.create({ url: 'https://gemini.google.com/app', active: false }),
        chrome.tabs.create({ url: 'https://claude.ai/new', active: false })
      ]);

      return { improved: improvedPrompt, broadcasted: true };
    } catch (error) {
      console.error('Broadcast error:', error);
      return { improved: originalPrompt, broadcasted: false, error: error.message };
    }
  }

  async broadcastSplit(originalPrompt, layout = 'horizontal') {
    try {
      const improvedPrompt = await this.improveAndSave(originalPrompt);
      await chrome.storage.local.set({ pendingPrompt: improvedPrompt });

      const currentWindow = await chrome.windows.getCurrent();
      const screenWidth = currentWindow.width || 1920;
      const screenHeight = currentWindow.height || 1080;
      const positions = this.calculatePositions(layout, screenWidth, screenHeight);

      const urls = [
        'https://chatgpt.com/',
        'https://claude.ai/new',
        'https://gemini.google.com/app'
      ];

      await Promise.all(urls.map((url, i) =>
        chrome.windows.create({
          url,
          type: 'normal',
          ...positions[i],
          focused: i === 0
        })
      ));

      return { improved: improvedPrompt, broadcasted: true };
    } catch (error) {
      console.error('BroadcastSplit error:', error);
      return { improved: originalPrompt, broadcasted: false, error: error.message };
    }
  }

  async improveAndSave(originalPrompt) {
    let improved = originalPrompt;

    if (this.memorySystem && this.openaiClient && this.isInitialized) {
      const context = await this.memorySystem.getMemoryContext();
      improved = await this.openaiClient.improvePrompt(originalPrompt, context);
      await this.memorySystem.saveConversation(originalPrompt);

      if (await this.memorySystem.needsDistillation()) {
        this.distillInBackground();
      }
    }

    return improved;
  }

  async distillInBackground() {
    try {
      const conversations = await this.memorySystem.getRecentConversations(20);
      const summary = await this.openaiClient.distillMemories(conversations);
      if (summary) {
        await this.memorySystem.saveMemory(summary);
        await this.memorySystem.clearOldConversations(50);
      }
    } catch (error) {
      console.error('Distillation error:', error);
    }
  }

  calculatePositions(layout, width, height) {
    switch (layout) {
      case 'vertical': {
        const h = Math.floor(height / 3);
        return [
          { left: 0, top: 0, width, height: h },
          { left: 0, top: h, width, height: h },
          { left: 0, top: h * 2, width, height: h }
        ];
      }
      case 'grid': {
        const hw = Math.floor(width / 2);
        const hh = Math.floor(height / 2);
        return [
          { left: 0, top: 0, width: hw, height: hh },
          { left: hw, top: 0, width: hw, height: hh },
          { left: 0, top: hh, width: hw, height: hh }
        ];
      }
      default: { // horizontal
        const w = Math.floor(width / 3);
        return [
          { left: 0, top: 0, width: w, height },
          { left: w, top: 0, width: w, height },
          { left: w * 2, top: 0, width: w, height }
        ];
      }
    }
  }

  async getPendingPrompt() {
    const result = await chrome.storage.local.get(['pendingPrompt']);
    return { prompt: result.pendingPrompt || null };
  }

  async clearPendingPrompt() {
    await chrome.storage.local.remove(['pendingPrompt']);
    return { success: true };
  }

  async setApiKey(apiKey) {
    await chrome.storage.local.set({ openaiApiKey: apiKey });
    this.openaiClient?.setApiKey(apiKey);
    return { success: true };
  }

  async setEnabled(enabled) {
    this.isEnabled = enabled;
    await chrome.storage.local.set({ isEnabled: enabled });
    return { success: true };
  }

  async getStatus() {
    const stored = await chrome.storage.local.get(['openaiApiKey', 'isEnabled']);
    let convCount = 0, memCount = 0;

    if (this.memorySystem && this.isInitialized) {
      try {
        convCount = await this.memorySystem.getConversationCount();
        const memories = await this.memorySystem.getMemories(10);
        memCount = memories.length;
      } catch (e) {
        console.error('Status error:', e);
      }
    }

    return {
      hasApiKey: !!stored.openaiApiKey,
      isEnabled: stored.isEnabled !== false,
      conversationCount: convCount,
      memoryCount: memCount,
      initialized: this.isInitialized
    };
  }

  async getMemories() {
    if (!this.memorySystem || !this.isInitialized) return [];
    return this.memorySystem.getMemories(20);
  }

  async getConversations() {
    if (!this.memorySystem || !this.isInitialized) return [];
    return this.memorySystem.getRecentConversations(50);
  }

  async clearMemory() {
    if (this.memorySystem && this.isInitialized) {
      await this.memorySystem.clearAll();
    }
    return { success: true };
  }

  async importMemory(data) {
    if (this.memorySystem && this.isInitialized) {
      await this.memorySystem.importData(data);
    }
    return { success: true };
  }
}

// Initialize
const broadcaster = new PromptBroadcaster();

// Message listener
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  broadcaster.handleMessage(message, sender)
    .then(sendResponse)
    .catch(error => sendResponse({ error: error.message }));
  return true;
});

// Commands
chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'open_side_panel') {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) chrome.sidePanel.open({ tabId: tab.id });
  }
});

// Action click opens side panel
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ tabId: tab.id });
});

// Storage change listener
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.openaiApiKey) {
    broadcaster.openaiClient?.setApiKey(changes.openaiApiKey.newValue || '');
  }
  if (changes.isEnabled !== undefined) {
    broadcaster.isEnabled = changes.isEnabled.newValue;
  }
});
