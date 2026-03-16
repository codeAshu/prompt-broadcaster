// Gemini content script - receives prompts and auto-submits

(function() {
  'use strict';

  // Selectors for Gemini UI elements
  const SELECTORS = {
    textarea: '.ql-editor, [contenteditable="true"]',
    sendButton: 'button[aria-label="Send message"], button.send-button, button[data-test-id="send-button"]'
  };

  function getTextarea() {
    // Gemini uses a rich text editor
    return document.querySelector('.ql-editor') ||
           document.querySelector('[contenteditable="true"][aria-label*="prompt"]') ||
           document.querySelector('rich-textarea [contenteditable="true"]') ||
           document.querySelector('[contenteditable="true"]');
  }

  function getSendButton() {
    return document.querySelector('button[aria-label="Send message"]') ||
           document.querySelector('button.send-button') ||
           document.querySelector('button[mattooltip="Send message"]') ||
           document.querySelector('button[aria-label="Submit"]');
  }

  function setPromptText(element, text) {
    if (!element) return false;

    // Focus the element
    element.focus();

    // Clear existing content
    element.innerHTML = '';

    // For Quill editor
    const p = document.createElement('p');
    p.textContent = text;
    element.appendChild(p);

    // Trigger input events
    element.dispatchEvent(new InputEvent('input', { bubbles: true, data: text }));
    element.dispatchEvent(new Event('change', { bubbles: true }));

    return true;
  }

  async function checkForPendingPrompt() {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_PENDING_PROMPT' });

      if (response && response.prompt) {
        // Wait for Gemini UI to be ready
        await waitForElement(SELECTORS.textarea, 10000);
        await new Promise(resolve => setTimeout(resolve, 1000)); // Extra wait for initialization

        const textarea = getTextarea();
        if (textarea) {
          const success = setPromptText(textarea, response.prompt);

          if (success) {
            // Wait a bit then click send
            await new Promise(resolve => setTimeout(resolve, 500));

            const sendButton = getSendButton();
            if (sendButton && !sendButton.disabled) {
              sendButton.click();
              console.log('Prompt Broadcaster: Gemini prompt submitted');
            } else {
              console.log('Prompt Broadcaster: Gemini send button not ready');
            }
          }
        }

        // Clear the pending prompt
        await chrome.runtime.sendMessage({ type: 'CLEAR_PENDING_PROMPT' });
      }
    } catch (error) {
      console.error('Prompt Broadcaster: Gemini error', error);
    }
  }

  function waitForElement(selector, timeout = 5000) {
    return new Promise((resolve, reject) => {
      const element = document.querySelector(selector);
      if (element) {
        resolve(element);
        return;
      }

      const observer = new MutationObserver((mutations, obs) => {
        const el = document.querySelector(selector);
        if (el) {
          obs.disconnect();
          resolve(el);
        }
      });

      observer.observe(document.body, {
        childList: true,
        subtree: true
      });

      setTimeout(() => {
        observer.disconnect();
        reject(new Error('Element not found: ' + selector));
      }, timeout);
    });
  }

  // Initialize
  function init() {
    // Check for pending prompt after page loads
    setTimeout(checkForPendingPrompt, 2000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
