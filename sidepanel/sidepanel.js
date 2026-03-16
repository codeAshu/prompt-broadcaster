// Side Panel UI logic

document.addEventListener('DOMContentLoaded', async () => {
  // Elements
  const promptInput = document.getElementById('promptInput');
  const charCount = document.getElementById('charCount');
  const broadcastBtn = document.getElementById('broadcastBtn');
  const statusDot = document.getElementById('statusDot');
  const statusText = document.getElementById('statusText');
  const memoryCount = document.getElementById('memoryCount');
  const convCount = document.getElementById('convCount');
  const previewSection = document.getElementById('previewSection');
  const improvedPrompt = document.getElementById('improvedPrompt');
  const memoryList = document.getElementById('memoryList');

  // Settings elements
  const settingsBtn = document.getElementById('settingsBtn');
  const settingsPanel = document.getElementById('settingsPanel');
  const closeSettings = document.getElementById('closeSettings');
  const apiKeyInput = document.getElementById('apiKey');
  const saveApiKeyBtn = document.getElementById('saveApiKey');
  const windowLayout = document.getElementById('windowLayout');
  const exportMemoryBtn = document.getElementById('exportMemory');
  const importMemoryBtn = document.getElementById('importMemory');
  const importFile = document.getElementById('importFile');
  const clearMemoryBtn = document.getElementById('clearMemory');

  // Character count
  promptInput.addEventListener('input', () => {
    charCount.textContent = promptInput.value.length;
  });

  // Settings panel
  settingsBtn.addEventListener('click', () => {
    settingsPanel.classList.remove('hidden');
  });

  closeSettings.addEventListener('click', () => {
    settingsPanel.classList.add('hidden');
  });

  // Load status and memory
  async function loadStatus() {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_STATUS' });
      memoryCount.textContent = response.memoryCount || 0;
      convCount.textContent = response.conversationCount || 0;

      if (!response.hasApiKey) {
        statusText.textContent = 'No API Key';
        statusDot.classList.add('error');
      } else {
        statusText.textContent = 'Ready';
        statusDot.classList.remove('error');
      }
    } catch (error) {
      console.error('Failed to load status:', error);
    }
  }

  async function loadMemories() {
    try {
      const memories = await chrome.runtime.sendMessage({ type: 'GET_MEMORIES' });

      if (memories && memories.length > 0) {
        memoryList.innerHTML = memories.map(m => `
          <div class="memory-item">${escapeHtml(m.summary)}</div>
        `).join('');
      } else {
        memoryList.innerHTML = '<p class="empty">No memories yet. Start chatting to build context.</p>';
      }
    } catch (error) {
      console.error('Failed to load memories:', error);
    }
  }

  // Broadcast functionality
  broadcastBtn.addEventListener('click', async () => {
    const prompt = promptInput.value.trim();
    if (!prompt) return;

    // Update UI
    broadcastBtn.disabled = true;
    statusText.textContent = 'Processing...';
    statusDot.classList.add('processing');

    try {
      // Get layout preference
      const layout = windowLayout.value;

      // Send broadcast request
      const response = await chrome.runtime.sendMessage({
        type: 'BROADCAST_SPLIT',
        prompt: prompt,
        layout: layout
      });

      if (response && response.improved) {
        // Show improved prompt
        improvedPrompt.textContent = response.improved;
        previewSection.classList.remove('hidden');

        statusText.textContent = 'Broadcasted!';
        statusDot.classList.remove('processing');

        // Clear input after success
        promptInput.value = '';
        charCount.textContent = '0';

        // Refresh stats
        loadStatus();
        loadMemories();
      } else if (response && response.error) {
        statusText.textContent = 'Error: ' + response.error;
        statusDot.classList.add('error');
      }
    } catch (error) {
      console.error('Broadcast error:', error);
      statusText.textContent = 'Error';
      statusDot.classList.add('error');
    } finally {
      broadcastBtn.disabled = false;
      setTimeout(() => {
        statusDot.classList.remove('processing');
      }, 500);
    }
  });

  // Keyboard shortcut: Ctrl/Cmd + Enter to broadcast
  promptInput.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      broadcastBtn.click();
    }
  });

  // Settings: Save API Key
  saveApiKeyBtn.addEventListener('click', async () => {
    const key = apiKeyInput.value.trim();
    if (key) {
      await chrome.runtime.sendMessage({ type: 'SET_API_KEY', apiKey: key });
      apiKeyInput.value = '••••••••••••••••';
      loadStatus();
    }
  });

  // Load API key on settings open
  settingsBtn.addEventListener('click', async () => {
    const result = await chrome.storage.local.get(['openaiApiKey', 'windowLayout']);
    if (result.openaiApiKey) {
      apiKeyInput.value = '••••••••••••••••';
    }
    if (result.windowLayout) {
      windowLayout.value = result.windowLayout;
    }
  });

  // Save layout preference
  windowLayout.addEventListener('change', async () => {
    await chrome.storage.local.set({ windowLayout: windowLayout.value });
  });

  // Export memory
  exportMemoryBtn.addEventListener('click', async () => {
    try {
      const [conversations, memories] = await Promise.all([
        chrome.runtime.sendMessage({ type: 'GET_CONVERSATIONS' }),
        chrome.runtime.sendMessage({ type: 'GET_MEMORIES' })
      ]);

      const exportData = {
        version: 1,
        exportedAt: new Date().toISOString(),
        conversations: conversations || [],
        memories: memories || []
      };

      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `prompt-broadcaster-memory-${new Date().toISOString().split('T')[0]}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Export failed:', error);
    }
  });

  // Import memory
  importMemoryBtn.addEventListener('click', () => {
    importFile.click();
  });

  importFile.addEventListener('change', async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    try {
      const text = await file.text();
      const data = JSON.parse(text);

      if (!data.version || !data.conversations || !data.memories) {
        throw new Error('Invalid file format');
      }

      await chrome.runtime.sendMessage({ type: 'IMPORT_MEMORY', data });
      loadStatus();
      loadMemories();
    } catch (error) {
      console.error('Import failed:', error);
    }

    importFile.value = '';
  });

  // Clear memory
  clearMemoryBtn.addEventListener('click', async () => {
    if (confirm('Clear all memory and history?')) {
      await chrome.runtime.sendMessage({ type: 'CLEAR_MEMORY' });
      loadStatus();
      loadMemories();
    }
  });

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // Initialize
  loadStatus();
  loadMemories();
});
