// Memory system using IndexedDB

const DB_NAME = 'PromptBroadcasterDB';
const DB_VERSION = 1;

export class MemorySystem {
  constructor() {
    this.db = null;
    this.DISTILL_THRESHOLD = 10;
  }

  async init() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        resolve(this.db);
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        if (!db.objectStoreNames.contains('conversations')) {
          const convStore = db.createObjectStore('conversations', { keyPath: 'id', autoIncrement: true });
          convStore.createIndex('timestamp', 'timestamp', { unique: false });
        }

        if (!db.objectStoreNames.contains('memories')) {
          const memStore = db.createObjectStore('memories', { keyPath: 'id', autoIncrement: true });
          memStore.createIndex('timestamp', 'timestamp', { unique: false });
        }

        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', { keyPath: 'key' });
        }
      };
    });
  }

  async saveConversation(prompt, platform = 'chatgpt') {
    const conversation = {
      prompt,
      platform,
      timestamp: Date.now(),
      responses: {}
    };

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('conversations', 'readwrite');
      const store = tx.objectStore('conversations');
      const request = store.add(conversation);

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async getRecentConversations(limit = 20) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('conversations', 'readonly');
      const store = tx.objectStore('conversations');
      const index = store.index('timestamp');
      const request = index.openCursor(null, 'prev');
      const results = [];

      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor && results.length < limit) {
          results.push(cursor.value);
          cursor.continue();
        } else {
          resolve(results);
        }
      };

      request.onerror = () => reject(request.error);
    });
  }

  async getConversationCount() {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('conversations', 'readonly');
      const store = tx.objectStore('conversations');
      const request = store.count();

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async saveMemory(summary, keywords = []) {
    const memory = {
      summary,
      keywords,
      timestamp: Date.now()
    };

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('memories', 'readwrite');
      const store = tx.objectStore('memories');
      const request = store.add(memory);

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async getMemories(limit = 10) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('memories', 'readonly');
      const store = tx.objectStore('memories');
      const index = store.index('timestamp');
      const request = index.openCursor(null, 'prev');
      const results = [];

      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor && results.length < limit) {
          results.push(cursor.value);
          cursor.continue();
        } else {
          resolve(results);
        }
      };

      request.onerror = () => reject(request.error);
    });
  }

  async getMemoryContext() {
    const [memories, recentConvs] = await Promise.all([
      this.getMemories(5),
      this.getRecentConversations(5)
    ]);

    const memoryText = memories.length > 0
      ? memories.map(m => m.summary).join('\n')
      : 'No memories yet.';

    const recentTopics = recentConvs.length > 0
      ? recentConvs.map(c => c.prompt.substring(0, 100)).join('\n- ')
      : 'No recent topics.';

    return { memories: memoryText, recentTopics };
  }

  async clearOldConversations(keepCount = 100) {
    const conversations = await this.getRecentConversations(1000);
    if (conversations.length <= keepCount) return 0;

    const toDelete = conversations.slice(keepCount);

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('conversations', 'readwrite');
      const store = tx.objectStore('conversations');
      let deleted = 0;

      for (const conv of toDelete) {
        const request = store.delete(conv.id);
        request.onsuccess = () => {
          deleted++;
          if (deleted === toDelete.length) resolve(deleted);
        };
        request.onerror = () => reject(request.error);
      }

      if (toDelete.length === 0) resolve(0);
    });
  }

  async clearAll() {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(['conversations', 'memories'], 'readwrite');
      tx.objectStore('conversations').clear();
      tx.objectStore('memories').clear();
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  }

  async importData(data) {
    await this.clearAll();

    if (data.conversations?.length > 0) {
      const convTx = this.db.transaction('conversations', 'readwrite');
      const convStore = convTx.objectStore('conversations');

      for (const conv of data.conversations) {
        const { id, ...convData } = conv;
        convStore.add(convData);
      }

      await new Promise((resolve, reject) => {
        convTx.oncomplete = resolve;
        convTx.onerror = () => reject(convTx.error);
      });
    }

    if (data.memories?.length > 0) {
      const memTx = this.db.transaction('memories', 'readwrite');
      const memStore = memTx.objectStore('memories');

      for (const mem of data.memories) {
        const { id, ...memData } = mem;
        memStore.add(memData);
      }

      await new Promise((resolve, reject) => {
        memTx.oncomplete = resolve;
        memTx.onerror = () => reject(memTx.error);
      });
    }

    return true;
  }

  async needsDistillation() {
    const count = await this.getConversationCount();
    const memories = await this.getMemories(1);
    const lastDistillCount = memories.length > 0 ? (memories[0].convCount || 0) : 0;
    return count - lastDistillCount >= this.DISTILL_THRESHOLD;
  }
}
