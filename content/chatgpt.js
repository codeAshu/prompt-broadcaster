// ChatGPT content script - intercepts submissions and broadcasts to other models

(function() {
  'use strict';

  let isProcessing = false;

  // Selectors for ChatGPT UI elements (may need updates as UI changes)
  const SELECTORS = {
    textarea: '#prompt-textarea',
    sendButton: 'button[data-testid="send-button"]',
    form: 'form'
  };

  function getTextarea() {
    // ChatGPT uses a contenteditable div inside the textarea container
    const textarea = document.querySelector(SELECTORS.textarea);
    if (textarea) return textarea;

    // Fallback selectors
    return document.querySelector('[contenteditable="true"][data-id="root"]') ||
           document.querySelector('textarea[placeholder*="Message"]') ||
           document.querySelector('div[contenteditable="true"]');
  }

  function getSendButton() {
    return document.querySelector(SELECTORS.sendButton) ||
           document.querySelector('button[aria-label="Send message"]') ||
           document.querySelector('button svg[data-icon="paper-plane"]')?.closest('button');
  }

  function getPromptText(element) {
    if (!element) return '';
    // Handle both textarea and contenteditable
    return element.value || element.innerText || element.textContent || '';
  }

  function setPromptText(element, text) {
    if (!element) return;

    if (element.tagName === 'TEXTAREA') {
      element.value = text;
      element.dispatchEvent(new Event('input', { bubbles: true }));
    } else {
      // Contenteditable div
      element.innerHTML = '';
      const p = document.createElement('p');
      p.textContent = text;
      element.appendChild(p);
      element.dispatchEvent(new InputEvent('input', { bubbles: true }));
    }
  }

  async function handleSubmit(event) {
    if (isProcessing) return;

    const textarea = getTextarea();
    const originalPrompt = getPromptText(textarea).trim();

    if (!originalPrompt) return;

    // Prevent default submission
    event.preventDefault();
    event.stopPropagation();

    isProcessing = true;

    try {
      // Send to background script for improvement and broadcasting
      const response = await chrome.runtime.sendMessage({
        type: 'BROADCAST_PROMPT',
        prompt: originalPrompt
      });

      if (response && response.improved) {
        // Replace with improved prompt
        setPromptText(textarea, response.improved);

        // Small delay to ensure UI updates
        await new Promise(resolve => setTimeout(resolve, 100));

        // Now submit the improved prompt
        const sendButton = getSendButton();
        if (sendButton && !sendButton.disabled) {
          sendButton.click();
        }
      }
    } catch (error) {
      console.error('Prompt Broadcaster error:', error);
      // On error, let original submission happen
      const sendButton = getSendButton();
      if (sendButton) sendButton.click();
    } finally {
      isProcessing = false;
    }
  }

  function setupInterception() {
    // Watch for send button clicks
    document.addEventListener('click', (event) => {
      const sendButton = getSendButton();
      if (sendButton && (event.target === sendButton || sendButton.contains(event.target))) {
        handleSubmit(event);
      }
    }, true);

    // Watch for Enter key (without Shift)
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        const textarea = getTextarea();
        if (textarea && document.activeElement === textarea) {
          handleSubmit(event);
        }
      }
    }, true);
  }

  // Initialize when DOM is ready
  function init() {
    // Wait for ChatGPT UI to load
    const observer = new MutationObserver((mutations, obs) => {
      const textarea = getTextarea();
      if (textarea) {
        obs.disconnect();
        setupInterception();
        console.log('Prompt Broadcaster: ChatGPT interception active');
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    // Also check immediately
    if (getTextarea()) {
      observer.disconnect();
      setupInterception();
      console.log('Prompt Broadcaster: ChatGPT interception active');
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
