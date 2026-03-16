// Claude content script - receives prompts and auto-submits

(function() {
  'use strict';

  // Selectors for Claude UI elements
  const SELECTORS = {
    textarea: '[contenteditable="true"].ProseMirror, div[contenteditable="true"]',
    sendButton: 'button[aria-label="Send Message"], button[type="submit"]'
  };

  function getTextarea() {
    // Claude uses ProseMirror editor
    return document.querySelector('[contenteditable="true"].ProseMirror') ||
           document.querySelector('div[contenteditable="true"][data-placeholder]') ||
           document.querySelector('fieldset [contenteditable="true"]') ||
           document.querySelector('[contenteditable="true"]');
  }

  function getSendButton() {
    return document.querySelector('button[aria-label="Send Message"]') ||
           document.querySelector('button[aria-label="Send message"]') ||
           document.querySelector('fieldset button[type="button"]:not([aria-label])') ||
           document.querySelector('button svg[viewBox="0 0 24 24"]')?.closest('button');
  }

  function setPromptText(element, text) {
    if (!element) return false;

    // Focus the element
    element.focus();

    // Clear existing content
    element.innerHTML = '';

    // For ProseMirror, we need to insert as paragraph
    const p = document.createElement('p');
    p.textContent = text;
    element.appendChild(p);

    // Trigger input events for ProseMirror to pick up
    element.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      cancelable: true,
      inputType: 'insertText',
      data: text
    }));

    // Also try direct text content in case innerHTML doesn't work
    if (!element.textContent) {
      element.textContent = text;
      element.dispatchEvent(new Event('input', { bubbles: true }));
    }

    return true;
  }

  async function checkForPendingPrompt() {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_PENDING_PROMPT' });

      if (response && response.prompt) {
        // Wait for Claude UI to be ready
        await waitForElement(SELECTORS.textarea, 10000);
        await new Promise(resolve => setTimeout(resolve, 1500)); // Extra wait for initialization

        const textarea = getTextarea();
        if (textarea) {
          const success = setPromptText(textarea, response.prompt);

          if (success) {
            // Wait a bit then click send
            await new Promise(resolve => setTimeout(resolve, 500));

            const sendButton = getSendButton();
            if (sendButton && !sendButton.disabled) {
              sendButton.click();
              console.log('Prompt Broadcaster: Claude prompt submitted');
            } else {
              console.log('Prompt Broadcaster: Claude send button not ready, trying Enter key');
              // Try Enter key as fallback
              textarea.dispatchEvent(new KeyboardEvent('keydown', {
                key: 'Enter',
                code: 'Enter',
                keyCode: 13,
                which: 13,
                bubbles: true
              }));
            }
          }
        }

        // Clear the pending prompt
        await chrome.runtime.sendMessage({ type: 'CLEAR_PENDING_PROMPT' });
      }
    } catch (error) {
      console.error('Prompt Broadcaster: Claude error', error);
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
