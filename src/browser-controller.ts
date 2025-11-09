import { chromium, Browser, Page } from 'playwright';
import { promises as fs } from 'fs';
import { PageState, UIElement } from './types';

export class BrowserController {
  private browser: Browser | null = null;
  private page: Page | null = null;

  async initialize(config: {
    headless: boolean;
    slowMo: number;
    viewportWidth: number;
    viewportHeight: number;
  }): Promise<void> {
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

  async navigate(url: string): Promise<void> {
    if (!this.page) throw new Error('Browser not initialized');
    await this.page.goto(url, { waitUntil: 'networkidle' });
    await this.page.waitForTimeout(1000);
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
    if (this.browser) {
      await this.browser.close();
    }
  }

  async keepAlive(seconds: number): Promise<void> {
    if (!this.page) throw new Error('Browser not initialized');
    await this.page.waitForTimeout(seconds * 1000);
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
        '[onclick]',
        '[data-testid]',
      ];

      const results: Array<{
        selector: string;
        text: string;
        role: string;
        isVisible: boolean;
        boundingBox: { x: number; y: number; width: number; height: number } | undefined;
      }> = [];

      interactiveSelectors.forEach((selectorType) => {
        const elements = document.querySelectorAll(selectorType);
        elements.forEach((el) => {
          const rect = el.getBoundingClientRect();
          const isVisible =
            rect.width > 0 &&
            rect.height > 0 &&
            window.getComputedStyle(el).visibility !== 'hidden' &&
            window.getComputedStyle(el).display !== 'none';

          if (!isVisible) return;

          const text = (el.textContent || '').trim().slice(0, 100);
          const role = el.getAttribute('role') || el.tagName.toLowerCase();
          
          let selector = el.tagName.toLowerCase();
          if (el.id) {
            selector = `#${el.id}`;
          } else if (el.className && typeof el.className === 'string') {
            const classes = el.className.split(' ').filter((c: string) => c).slice(0, 3).join('.');
            if (classes) {
              selector = `${selector}.${classes}`;
            }
          }
          
          const testId = el.getAttribute('data-testid');
          if (testId) {
            selector = `[data-testid="${testId}"]`;
          }

          const ariaLabel = el.getAttribute('aria-label');
          if (ariaLabel) {
            selector = `${selector}[aria-label="${ariaLabel}"]`;
          }

          results.push({
            selector,
            text,
            role,
            isVisible,
            boundingBox: isVisible ? {
              x: rect.x,
              y: rect.y,
              width: rect.width,
              height: rect.height,
            } : undefined,
          });
        });
      });

      return results.filter(el => el.isVisible);
    });

    return elements;
  }
}

