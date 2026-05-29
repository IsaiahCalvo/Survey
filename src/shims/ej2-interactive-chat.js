/**
 * ej2-interactive-chat.js — drop-in shim for Syncfusion's @syncfusion/ej2-interactive-chat.
 *
 * Exports a minimal AIAssistView class that mimics the prompt/response API
 * (appendTo, executePrompt, addPromptResponse, destroy) by building plain DOM,
 * so the bundle can stand in for the real EJ2 package without pulling it in.
 */
export class AIAssistView {
  constructor(options = {}) {
    this.options = options;
    this.prompts = Array.isArray(options.prompts) ? [...options.prompts] : [];
    this.prompt = '';
    this.promptPlaceholder = options.promptPlaceholder ?? '';
    this.promptSuggestions = options.promptSuggestions ?? [];
    this.bannerTemplate = options.bannerTemplate ?? '';
    this.enablePersistence = Boolean(options.enablePersistence);
    this.cssClass = options.cssClass ?? '';
    this.element = document.createElement('div');
    this.element.className = 'e-aiassistview-shim';

    const header = document.createElement('div');
    header.className = 'e-view-header';
    const headerToolbar = document.createElement('div');
    headerToolbar.className = 'e-toolbar';
    header.appendChild(headerToolbar);
    this.element.appendChild(header);

    const textarea = document.createElement('textarea');
    textarea.className = 'e-assist-textarea';
    this.element.appendChild(textarea);

    const footer = document.createElement('div');
    footer.className = 'e-footer';
    const footerToolbar = document.createElement('div');
    footerToolbar.className = 'e-toolbar';
    footer.appendChild(footerToolbar);
    this.element.appendChild(footer);
  }

  appendTo(target) {
    const host = typeof target === 'string' ? document.querySelector(target) : target;
    if (host && this.element.parentElement !== host) {
      host.appendChild(this.element);
    }
  }

  executePrompt(prompt = '') {
    this.prompt = prompt;
    this.prompts.push({ prompt, response: '' });
    if (typeof this.options.promptRequest === 'function') {
      this.options.promptRequest({
        cancel: false,
        prompt,
        responseToolbarItems: [],
        promptSuggestions: this.promptSuggestions
      });
    }
  }

  addPromptResponse(response = '', isFinalUpdate = true) {
    if (this.prompts.length === 0) {
      this.prompts.push({ prompt: this.prompt || '', response: '' });
    }
    const lastPrompt = this.prompts[this.prompts.length - 1];
    if (isFinalUpdate) {
      lastPrompt.response = response;
      return;
    }
    lastPrompt.response = `${lastPrompt.response || ''}${response}`;
  }

  scrollToBottom() {}

  dataBind() {}

  destroy() {
    this.element?.remove();
  }
}
