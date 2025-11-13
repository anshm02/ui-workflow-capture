import { chromium, Browser, BrowserContext, Page } from 'playwright';
import { promises as fs } from 'fs';
import { PageState, UIElement } from './types';

export class BrowserController {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private userDataDir: string | null = null;

  async initialize(config: {
    headless: boolean;
    slowMo: number;
    viewportWidth: number;
    viewportHeight: number;
    userDataDir?: string;
  }): Promise<void> {
    // Use persistent context if userDataDir is provided (maintains auth between runs)
    if (config.userDataDir) {
      this.userDataDir = config.userDataDir;
      
      // Ensure directory exists
      await fs.mkdir(this.userDataDir, { recursive: true });

      // Launch persistent context - saves cookies, localStorage, session data
      this.context = await chromium.launchPersistentContext(this.userDataDir, {
        headless: config.headless,
        slowMo: config.slowMo,
        viewport: {
          width: config.viewportWidth,
          height: config.viewportHeight,
        },
        acceptDownloads: true,
        channel: 'chrome'
      });

      // Get existing page or create new one
      this.page = this.context.pages()[0] || await this.context.newPage();
    } else {
      // Standard non-persistent mode
      this.browser = await chromium.launch({
        headless: config.headless,
        slowMo: config.slowMo,
      });

      this.page = await this.browser.newPage();
      await this.page.setViewportSize({
        width: config.viewportWidth,
        height: config.viewportHeight,
      });
    }
  }

  async navigate(url: string): Promise<void> {
    if (!this.page) throw new Error('Browser not initialized');
    await this.page.goto(url, 
      { waitUntil: 'domcontentloaded', 
        timeout: 30000
      });
    await this.page.waitForTimeout(2000);
  }

  async capturePageState(): Promise<PageState> {
    if (!this.page) throw new Error('Browser not initialized');

    const url = this.page.url();
    const title = await this.page.title();
    const screenshotBuffer = await this.page.screenshot({ type: 'png' });
    const screenshotBase64 = screenshotBuffer.toString('base64');

    const interactiveElements = await this.extractInteractiveElements();

    return {
      url,
      title,
      interactiveElements,
      screenshotBase64,
    };
  }

  async click(selector: string): Promise<{ x: number; y: number }> {
    if (!this.page) throw new Error('Browser not initialized');

    const element = await this.page.locator(selector).first();
    const boundingBox = await element.boundingBox();

    if (!boundingBox) {
      throw new Error(`Element not found or not visible: ${selector}`);
    }

    const x = boundingBox.x + boundingBox.width / 2;
    const y = boundingBox.y + boundingBox.height / 2;

    await element.click();
    await this.page.waitForTimeout(1000);

    return { x, y };
  }

  async type(selector: string, text: string): Promise<void> {
    if (!this.page) throw new Error('Browser not initialized');

    const element = await this.page.locator(selector).first();
    await element.click();
    await element.fill(text);
    await this.page.waitForTimeout(500);
  }

  async saveScreenshot(path: string): Promise<void> {
    if (!this.page) throw new Error('Browser not initialized');
    await this.page.screenshot({ path, type: 'png' });
  }

  async close(): Promise<void> {
    // Close context if using persistent mode, otherwise close browser
    if (this.context) {
      await this.context.close();
    } else if (this.browser) {
      await this.browser.close();
    }
  }

  async keepAlive(seconds: number): Promise<void> {
    if (!this.page) throw new Error('Browser not initialized');
    await this.page.waitForTimeout(seconds * 1000);
  }

  async saveElementsToJson(elements: UIElement[], path: string): Promise<void> {
    const jsonData = JSON.stringify(elements, null, 2);
    await fs.writeFile(path, jsonData, 'utf-8');
  }

  private async extractInteractiveElements(): Promise<UIElement[]> {
    if (!this.page) throw new Error('Browser not initialized');

    const elements = await this.page.evaluate(() => {
      const interactiveSelectors = [
        'button',
        'a',
        'input',
        'textarea',
        'select',
        '[role="button"]',
        '[role="link"]',
        '[role="textbox"]',
        '[contenteditable="true"]',
        '[onclick]',
        '[data-testid]',
      ];

      const results: Array<{
        selector: string;
        text: string;
        role: string;
        isVisible: boolean;
        boundingBox: { x: number; y: number; width: number; height: number } | undefined;
        ariaLabel?: string;
        placeholder?: string;
        title?: string;
        name?: string;
        type?: string;
        value?: string;
      }> = [];

      const seenElements = new Set<Element>();

      interactiveSelectors.forEach((selectorType) => {
        const elements = document.querySelectorAll(selectorType);
        elements.forEach((el) => {
          if (seenElements.has(el)) return;
          seenElements.add(el);

          const rect = el.getBoundingClientRect();
          const isVisible =
            rect.width > 0 &&
            rect.height > 0 &&
            window.getComputedStyle(el).visibility !== 'hidden' &&
            window.getComputedStyle(el).display !== 'none';

          if (!isVisible) return;

          const htmlEl = el as HTMLElement;
          const text = (el.textContent || '').trim().slice(0, 100);
          
          const ariaRole = el.getAttribute('role');
          const tagName = el.tagName.toLowerCase();
          const ariaLabel = el.getAttribute('aria-label');
          const placeholder = (htmlEl as HTMLInputElement).placeholder;
          const title = htmlEl.title;
          const name = (htmlEl as HTMLInputElement).name;
          const type = (htmlEl as HTMLInputElement).type;
          const value = (htmlEl as HTMLInputElement).value;
          const testId = el.getAttribute('data-testid');
          const contentEditable = htmlEl.contentEditable === 'true';
          
          let role = ariaRole || tagName;
          if (tagName === 'input' && type) {
            role = type === 'text' || type === 'email' || type === 'password' || type === 'search' || type === 'tel' || type === 'url' ? 'textbox' : type;
          } else if (tagName === 'textarea') {
            role = 'textbox';
          } else if (contentEditable) {
            role = 'textbox';
          }

          let selector = '';
          let locatorParts: string[] = [];

          if (testId) {
            selector = `[data-testid="${testId}"]`;
            locatorParts.push(`testId="${testId}"`);
          } else if (ariaLabel) {
            if (role === 'button' || role === 'link' || role === 'textbox' || ariaRole) {
              selector = `${tagName}[aria-label="${ariaLabel}"]`;
              locatorParts.push(`role="${role}" name="${ariaLabel}"`);
            } else {
              selector = `[aria-label="${ariaLabel}"]`;
              locatorParts.push(`label="${ariaLabel}"`);
            }
          } else if (placeholder && (tagName === 'input' || tagName === 'textarea')) {
            selector = `${tagName}[placeholder="${placeholder}"]`;
            locatorParts.push(`placeholder="${placeholder}"`);
          } else if (text && text.length > 0 && text.length <= 50 && (tagName === 'button' || tagName === 'a' || ariaRole === 'button' || ariaRole === 'link')) {
            const escapedText = text.replace(/"/g, '\\"');
            selector = `${tagName}:has-text("${escapedText}")`;
            locatorParts.push(`role="${role}" name="${text}"`);
          } else if (contentEditable) {
            selector = `${tagName}[contenteditable="true"]`;
            locatorParts.push(`role="${role}"`);
          } else if (ariaRole && (ariaRole === 'button' || ariaRole === 'link' || ariaRole === 'textbox' || ariaRole === 'checkbox' || ariaRole === 'radio')) {
            selector = `${tagName}[role="${ariaRole}"]`;
            locatorParts.push(`role="${ariaRole}"`);
          } else if (name) {
            selector = `${tagName}[name="${name}"]`;
            locatorParts.push(`name="${name}"`);
          } else {
            if (el.id) {
              selector = `#${el.id}`;
            } else if (el.className && typeof el.className === 'string') {
              const classes = el.className.split(' ').filter((c: string) => c && !/^[0-9]/.test(c)).slice(0, 2).join('.');
              if (classes) {
                selector = `${tagName}.${classes}`;
              } else {
                selector = tagName;
              }
            } else {
              selector = tagName;
            }
          }

          results.push({
            selector,
            text,
            role,
            isVisible,
            boundingBox: {
              x: rect.x,
              y: rect.y,
              width: rect.width,
              height: rect.height,
            },
            ariaLabel: ariaLabel || undefined,
            placeholder: placeholder || undefined,
            title: title || undefined,
            name: name || undefined,
            type: type || undefined,
            value: value || undefined,
          });
        });
      });

      return results;
    });

    return elements;
  }
}

