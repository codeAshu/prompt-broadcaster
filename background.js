// Background service worker for Prompt Broadcaster

// Import dependencies
importScripts('lib/memory.js', 'lib/openai.js');

let memorySystem = null;
let openaiClient = null;
let isEnabled = true;

// Initialize systems
async function initialize() {
  memorySystem = new MemorySystem();
  await memorySystem.init();

  // Load API key from storage
  const result = await chrome.storage.local.get(['openaiApiKey', 'isEnabled']);
  openaiClient = new OpenAIClient(result.openaiApiKey || '');
  isEnabled = result.isEnabled !== false; // Default to true

  console.log('Prompt Broadcaster initialized');
}

initialize();

// Listen for messages from content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'BROADCAST_PROMPT') {
    handleBroadcast(message.prompt, sender.tab).then(sendResponse);
    return true; // Keep channel open for async response
  }

  if (message.type === 'GET_PENDING_PROMPT') {
    // Gemini/Claude tabs asking for their prompt
    chrome.storage.local.get(['pendingPrompt'], (result) => {
      sendResponse({ prompt: result.pendingPrompt || null });
    });
    return true;
  }

  if (message.type === 'CLEAR_PENDING_PROMPT') {
    chrome.storage.local.remove(['pendingPrompt']);
    sendResponse({ success: true });
    return true;
  }

  if (message.type === 'SET_API_KEY') {
    openaiClient.setApiKey(message.apiKey);
    chrome.storage.local.set({ openaiApiKey: message.apiKey });
    sendResponse({ success: true });
    return true;
  }

  if (message.type === 'SET_ENABLED') {
    isEnabled = message.enabled;
    chrome.storage.local.set({ isEnabled: message.enabled });
    sendResponse({ success: true });
    return true;
  }

  if (message.type === 'GET_STATUS') {
    chrome.storage.local.get(['openaiApiKey', 'isEnabled'], async (result) => {
      const convCount = await memorySystem.getConversationCount();
      const memories = await memorySystem.getMemories(10);
      sendResponse({
        hasApiKey: !!result.openaiApiKey,
        isEnabled: result.isEnabled !== false,
        conversationCount: convCount,
        memoryCount: memories.length
      });
    });
    return true;
  }

  if (message.type === 'GET_MEMORIES') {
    memorySystem.getMemories(20).then(sendResponse);
    return true;
  }

  if (message.type === 'GET_CONVERSATIONS') {
    memorySystem.getRecentConversations(50).then(sendResponse);
    return true;
  }

  if (message.type === 'CLEAR_MEMORY') {
    memorySystem.clearAll().then(() => sendResponse({ success: true }));
    return true;
  }

  if (message.type === 'IMPORT_MEMORY') {
    memorySystem.importData(message.data).then(() => sendResponse({ success: true }));
    return true;
  }
});

async function handleBroadcast(originalPrompt, sourceTab) {
  if (!isEnabled) {
    return { improved: originalPrompt, broadcasted: false };
  }

  try {
    // Get memory context
    const memoryContext = await memorySystem.getMemoryContext();

    // Improve the prompt
    const improvedPrompt = await openaiClient.improvePrompt(originalPrompt, memoryContext);

    // Save conversation
    await memorySystem.saveConversation(originalPrompt);

    // Check if we need to distill memories
    if (await memorySystem.needsDistillation()) {
      distillMemoriesInBackground();
    }

    // Store the improved prompt for Gemini/Claude tabs
    await chrome.storage.local.set({ pendingPrompt: improvedPrompt });

    // Open Gemini and Claude tabs
    await Promise.all([
      chrome.tabs.create({
        url: 'https://gemini.google.com/app',
        active: false
      }),
      chrome.tabs.create({
        url: 'https://claude.ai/new',
        active: false
      })
    ]);

    return { improved: improvedPrompt, broadcasted: true };
  } catch (error) {
    console.error('Broadcast error:', error);
    return { improved: originalPrompt, broadcasted: false, error: error.message };
  }
}

async function distillMemoriesInBackground() {
  try {
    const conversations = await memorySystem.getRecentConversations(20);
    const summary = await openaiClient.distillMemories(conversations);

    if (summary) {
      await memorySystem.saveMemory(summary);
      // Clean up old conversations to save space
      await memorySystem.clearOldConversations(50);
      console.log('Memory distillation complete');
    }
  } catch (error) {
    console.error('Memory distillation failed:', error);
  }
}

// Re-initialize when storage changes (e.g., API key updated)
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local') {
    if (changes.openaiApiKey) {
      openaiClient.setApiKey(changes.openaiApiKey.newValue || '');
    }
    if (changes.isEnabled !== undefined) {
      isEnabled = changes.isEnabled.newValue;
    }
  }
});
