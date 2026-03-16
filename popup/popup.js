// Popup UI logic

document.addEventListener('DOMContentLoaded', async () => {
  const enableToggle = document.getElementById('enableToggle');
  const apiKeyInput = document.getElementById('apiKey');
  const saveKeyBtn = document.getElementById('saveKey');
  const statusText = document.getElementById('statusText');
  const convCount = document.getElementById('convCount');
  const memCount = document.getElementById('memCount');
  const memoriesList = document.getElementById('memoriesList');
  const viewConversationsBtn = document.getElementById('viewConversations');
  const clearMemoryBtn = document.getElementById('clearMemory');
  const historyModal = document.getElementById('historyModal');
  const closeModalBtn = document.getElementById('closeModal');
  const historyList = document.getElementById('historyList');

  // Load current status
  async function loadStatus() {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_STATUS' });

      enableToggle.checked = response.isEnabled;
      convCount.textContent = response.conversationCount || 0;
      memCount.textContent = response.memoryCount || 0;

      if (response.hasApiKey && response.isEnabled) {
        statusText.textContent = 'Active';
        statusText.className = 'value active';
      } else if (!response.hasApiKey) {
        statusText.textContent = 'No API Key';
        statusText.className = 'value inactive';
      } else {
        statusText.textContent = 'Disabled';
        statusText.className = 'value inactive';
      }
    } catch (error) {
      console.error('Failed to load status:', error);
      statusText.textContent = 'Error';
      statusText.className = 'value inactive';
    }
  }

  // Load memories
  async function loadMemories() {
    try {
      const memories = await chrome.runtime.sendMessage({ type: 'GET_MEMORIES' });

      if (memories && memories.length > 0) {
        memoriesList.innerHTML = memories.map(m => `
          <div class="memory-item">
            ${escapeHtml(m.summary)}
          </div>
        `).join('');
      } else {
        memoriesList.innerHTML = '<p class="empty">No memories yet</p>';
      }
    } catch (error) {
      console.error('Failed to load memories:', error);
    }
  }

  // Load API key
  async function loadApiKey() {
    const result = await chrome.storage.local.get(['openaiApiKey']);
    if (result.openaiApiKey) {
      apiKeyInput.value = '••••••••••••••••';
      apiKeyInput.dataset.hasKey = 'true';
    }
  }

  // Save API key
  saveKeyBtn.addEventListener('click', async () => {
    const key = apiKeyInput.value.trim();
    if (key && !key.startsWith('•')) {
      await chrome.runtime.sendMessage({ type: 'SET_API_KEY', apiKey: key });
      apiKeyInput.value = '••••••••••••••••';
      apiKeyInput.dataset.hasKey = 'true';
      loadStatus();
    }
  });

  // Clear masked key on focus
  apiKeyInput.addEventListener('focus', () => {
    if (apiKeyInput.dataset.hasKey === 'true') {
      apiKeyInput.value = '';
    }
  });

  // Toggle enabled state
  enableToggle.addEventListener('change', async () => {
    await chrome.runtime.sendMessage({ type: 'SET_ENABLED', enabled: enableToggle.checked });
    loadStatus();
  });

  // View conversation history
  viewConversationsBtn.addEventListener('click', async () => {
    try {
      const conversations = await chrome.runtime.sendMessage({ type: 'GET_CONVERSATIONS' });

      if (conversations && conversations.length > 0) {
        historyList.innerHTML = conversations.map(c => `
          <div class="history-item">
            <div class="prompt">${escapeHtml(c.prompt.substring(0, 200))}${c.prompt.length > 200 ? '...' : ''}</div>
            <div class="timestamp">${new Date(c.timestamp).toLocaleString()}</div>
          </div>
        `).join('');
      } else {
        historyList.innerHTML = '<p class="empty">No conversation history</p>';
      }

      historyModal.classList.remove('hidden');
    } catch (error) {
      console.error('Failed to load conversations:', error);
    }
  });

  // Close modal
  closeModalBtn.addEventListener('click', () => {
    historyModal.classList.add('hidden');
  });

  // Clear all memory
  clearMemoryBtn.addEventListener('click', async () => {
    if (confirm('Are you sure you want to clear all memory and history?')) {
      await chrome.runtime.sendMessage({ type: 'CLEAR_MEMORY' });
      loadStatus();
      loadMemories();
    }
  });

  // Export memory to JSON file
  const exportBtn = document.getElementById('exportMemory');
  const importBtn = document.getElementById('importMemory');
  const importFile = document.getElementById('importFile');

  exportBtn.addEventListener('click', async () => {
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
      alert('Failed to export memory');
    }
  });

  importBtn.addEventListener('click', () => {
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

      await chrome.runtime.sendMessage({
        type: 'IMPORT_MEMORY',
        data: data
      });

      loadStatus();
      loadMemories();
      alert('Memory imported successfully!');
    } catch (error) {
      console.error('Import failed:', error);
      alert('Failed to import: ' + error.message);
    }

    // Reset file input
    importFile.value = '';
  });

  // Escape HTML to prevent XSS
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // Initialize
  loadStatus();
  loadMemories();
  loadApiKey();
});
