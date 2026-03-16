// Background service worker for Prompt Broadcaster

// Import dependencies
importScripts('lib/memory.js', 'lib/openai.js');

let memorySystem = null;
let openaiClient = null;
let isEnabled = true;
let isInitialized = false;

// Initialize systems
async function initialize() {
  try {
    console.log('Prompt Broadcaster: Initializing...');

    memorySystem = new MemorySystem();
    await memorySystem.init();
    console.log('Prompt Broadcaster: IndexedDB initialized');

    // Load API key from storage
    const result = await chrome.storage.local.get(['openaiApiKey', 'isEnabled']);
    openaiClient = new OpenAIClient(result.openaiApiKey || '');
    isEnabled = result.isEnabled !== false; // Default to true
    isInitialized = true;

    console.log('Prompt Broadcaster: Fully initialized', {
      hasApiKey: !!result.openaiApiKey,
      isEnabled
    });
  } catch (error) {
    console.error('Prompt Broadcaster: Initialization failed', error);
    openaiClient = new OpenAIClient('');
    isInitialized = false;
  }
}

const initPromise = initialize();

async function ensureInitialized() {
  await initPromise;
  return isInitialized;
}

// Handle keyboard commands
chrome.commands.onCommand.addListener(async (command) => {
  console.log('Prompt Broadcaster: Command received', command);

  if (command === 'open_side_panel') {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) {
      chrome.sidePanel.open({ tabId: tab.id });
    }
  }
});

// Open side panel when extension icon is clicked
chrome.action.onClicked.addListener(async (tab) => {
  chrome.sidePanel.open({ tabId: tab.id });
});

// Listen for messages
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Prompt Broadcaster: Received message', message.type);

  (async () => {
    try {
      await ensureInitialized();

      switch (message.type) {
        case 'BROADCAST_PROMPT': {
          const result = await handleBroadcast(message.prompt, sender.tab);
          sendResponse(result);
          break;
        }

        case 'BROADCAST_SPLIT': {
          const result = await handleBroadcastSplit(message.prompt, message.layout || 'horizontal');
          sendResponse(result);
          break;
        }

        case 'GET_PENDING_PROMPT': {
          const result = await chrome.storage.local.get(['pendingPrompt']);
          sendResponse({ prompt: result.pendingPrompt || null });
          break;
        }

        case 'CLEAR_PENDING_PROMPT': {
          await chrome.storage.local.remove(['pendingPrompt']);
          sendResponse({ success: true });
          break;
        }

        case 'SET_API_KEY': {
          console.log('Prompt Broadcaster: Saving API key');
          await chrome.storage.local.set({ openaiApiKey: message.apiKey });
          if (openaiClient) {
            openaiClient.setApiKey(message.apiKey);
          }
          sendResponse({ success: true });
          break;
        }

        case 'SET_ENABLED': {
          isEnabled = message.enabled;
          await chrome.storage.local.set({ isEnabled: message.enabled });
          sendResponse({ success: true });
          break;
        }

        case 'GET_STATUS': {
          const stored = await chrome.storage.local.get(['openaiApiKey', 'isEnabled']);
          let convCount = 0;
          let memCount = 0;

          if (memorySystem && isInitialized) {
            try {
              convCount = await memorySystem.getConversationCount();
              const memories = await memorySystem.getMemories(10);
              memCount = memories.length;
            } catch (e) {
              console.error('Error getting counts:', e);
            }
          }

          sendResponse({
            hasApiKey: !!stored.openaiApiKey,
            isEnabled: stored.isEnabled !== false,
            conversationCount: convCount,
            memoryCount: memCount,
            initialized: isInitialized
          });
          break;
        }

        case 'GET_MEMORIES': {
          if (memorySystem && isInitialized) {
            const memories = await memorySystem.getMemories(20);
            sendResponse(memories);
          } else {
            sendResponse([]);
          }
          break;
        }

        case 'GET_CONVERSATIONS': {
          if (memorySystem && isInitialized) {
            const convs = await memorySystem.getRecentConversations(50);
            sendResponse(convs);
          } else {
            sendResponse([]);
          }
          break;
        }

        case 'CLEAR_MEMORY': {
          if (memorySystem && isInitialized) {
            await memorySystem.clearAll();
          }
          sendResponse({ success: true });
          break;
        }

        case 'IMPORT_MEMORY': {
          if (memorySystem && isInitialized) {
            await memorySystem.importData(message.data);
          }
          sendResponse({ success: true });
          break;
        }

        default:
          console.warn('Unknown message type:', message.type);
          sendResponse({ error: 'Unknown message type' });
      }
    } catch (error) {
      console.error('Prompt Broadcaster: Message handler error', error);
      sendResponse({ error: error.message });
    }
  })();

  return true;
});

// Handle broadcast from ChatGPT interception (opens new tabs)
async function handleBroadcast(originalPrompt, sourceTab) {
  console.log('Prompt Broadcaster: Broadcasting prompt', originalPrompt.substring(0, 50) + '...');

  if (!isEnabled) {
    return { improved: originalPrompt, broadcasted: false };
  }

  try {
    let improvedPrompt = originalPrompt;

    if (memorySystem && isInitialized && openaiClient) {
      const memoryContext = await memorySystem.getMemoryContext();
      improvedPrompt = await openaiClient.improvePrompt(originalPrompt, memoryContext);
      await memorySystem.saveConversation(originalPrompt);

      if (await memorySystem.needsDistillation()) {
        distillMemoriesInBackground();
      }
    }

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

// Handle broadcast from side panel (opens split windows)
async function handleBroadcastSplit(originalPrompt, layout) {
  console.log('Prompt Broadcaster: Broadcasting to split windows', layout);

  try {
    let improvedPrompt = originalPrompt;

    // Improve prompt with memory context
    if (memorySystem && isInitialized && openaiClient) {
      const memoryContext = await memorySystem.getMemoryContext();
      improvedPrompt = await openaiClient.improvePrompt(originalPrompt, memoryContext);
      await memorySystem.saveConversation(originalPrompt);

      if (await memorySystem.needsDistillation()) {
        distillMemoriesInBackground();
      }
    }

    // Store improved prompt for content scripts
    await chrome.storage.local.set({ pendingPrompt: improvedPrompt });

    // Get screen dimensions (approximate since we can't access screen directly)
    // Use typical screen size or get from current window
    const currentWindow = await chrome.windows.getCurrent();
    const screenWidth = currentWindow.width || 1920;
    const screenHeight = currentWindow.height || 1080;

    // Calculate window positions based on layout
    const windows = calculateWindowPositions(layout, screenWidth, screenHeight);

    // URLs to open
    const urls = [
      'https://chatgpt.com/',
      'https://claude.ai/new',
      'https://gemini.google.com/app'
    ];

    // Create windows
    const windowPromises = urls.map((url, index) => {
      const pos = windows[index];
      return chrome.windows.create({
        url: url,
        type: 'normal',
        left: pos.left,
        top: pos.top,
        width: pos.width,
        height: pos.height,
        focused: index === 0 // Focus first window
      });
    });

    await Promise.all(windowPromises);

    console.log('Prompt Broadcaster: Split windows created');
    return { improved: improvedPrompt, broadcasted: true };
  } catch (error) {
    console.error('Broadcast split error:', error);
    return { improved: originalPrompt, broadcasted: false, error: error.message };
  }
}

// Calculate window positions for different layouts
function calculateWindowPositions(layout, screenWidth, screenHeight) {
  const padding = 0; // No padding between windows

  switch (layout) {
    case 'horizontal':
      // Three windows side by side
      const width = Math.floor(screenWidth / 3);
      return [
        { left: 0, top: 0, width: width, height: screenHeight },
        { left: width, top: 0, width: width, height: screenHeight },
        { left: width * 2, top: 0, width: width, height: screenHeight }
      ];

    case 'vertical':
      // Three windows stacked
      const height = Math.floor(screenHeight / 3);
      return [
        { left: 0, top: 0, width: screenWidth, height: height },
        { left: 0, top: height, width: screenWidth, height: height },
        { left: 0, top: height * 2, width: screenWidth, height: height }
      ];

    case 'grid':
      // 2x2 grid (ChatGPT top-left, Claude top-right, Gemini bottom-left, empty bottom-right)
      const halfWidth = Math.floor(screenWidth / 2);
      const halfHeight = Math.floor(screenHeight / 2);
      return [
        { left: 0, top: 0, width: halfWidth, height: halfHeight },
        { left: halfWidth, top: 0, width: halfWidth, height: halfHeight },
        { left: 0, top: halfHeight, width: halfWidth, height: halfHeight }
      ];

    default:
      // Default to horizontal
      const defaultWidth = Math.floor(screenWidth / 3);
      return [
        { left: 0, top: 0, width: defaultWidth, height: screenHeight },
        { left: defaultWidth, top: 0, width: defaultWidth, height: screenHeight },
        { left: defaultWidth * 2, top: 0, width: defaultWidth, height: screenHeight }
      ];
  }
}

async function distillMemoriesInBackground() {
  try {
    const conversations = await memorySystem.getRecentConversations(20);
    const summary = await openaiClient.distillMemories(conversations);

    if (summary) {
      await memorySystem.saveMemory(summary);
      await memorySystem.clearOldConversations(50);
      console.log('Memory distillation complete');
    }
  } catch (error) {
    console.error('Memory distillation failed:', error);
  }
}

// Re-initialize when storage changes
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local') {
    if (changes.openaiApiKey && openaiClient) {
      openaiClient.setApiKey(changes.openaiApiKey.newValue || '');
    }
    if (changes.isEnabled !== undefined) {
      isEnabled = changes.isEnabled.newValue;
    }
  }
});
