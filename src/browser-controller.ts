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
    // Use persistent context if userDataDir is provided
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

  async click(selector: string, targetBox?: { x: number; y: number; width: number; height: number }): Promise<{ x: number; y: number }> {
    if (!this.page) throw new Error('Browser not initialized');

    const locator = this.page.locator(selector);
    const count = await locator.count();


    let elementToClick = null;
    let clickBoundingBox = null;

    if (targetBox && count > 1) {
      // Loop through all elements and find the one matching the target bounding box
      let bestMatch = null;
      let smallestDifference = Infinity;

      for (let i = 0; i < count; i++) {
        const element = locator.nth(i);
        const box = await element.boundingBox();

        if (box) {
          
          // Calculate difference between this box and target box
          const diff = Math.abs(box.x - targetBox.x) + 
                       Math.abs(box.y - targetBox.y) +
                       Math.abs(box.width - targetBox.width) +
                       Math.abs(box.height - targetBox.height);

          if (diff < smallestDifference) {
            smallestDifference = diff;
            bestMatch = element;
            clickBoundingBox = box;
          }
        }
      }

      if (bestMatch) {
        elementToClick = bestMatch;
      }
    }

    // Fallback: if no target box provided or no match found, use first element
    if (!elementToClick) {
      elementToClick = locator.first();
      clickBoundingBox = await elementToClick.boundingBox();
    }

    if (!clickBoundingBox) {
      throw new Error(`Element not found or not visible: ${selector}`);
    }

    const x = clickBoundingBox.x + clickBoundingBox.width / 2;
    const y = clickBoundingBox.y + clickBoundingBox.height / 2;

    console.log(`Clicking at: (${x}, ${y})`);

    await elementToClick.click();
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
        '[role="menuitem"]',
        '[role="tab"]',
        '[role="option"]',
        '[role="switch"]',
        '[role="checkbox"]',
        '[contenteditable="true"]',
        '[onclick]',
        '[data-testid]',
      ];

      interface ElementData {
        element: Element;
        selector: string;
        text: string;
        role: string;
        isVisible: boolean;
        boundingBox: { x: number; y: number; width: number; height: number };
        ariaLabel?: string;
        placeholder?: string;
        title?: string;
        name?: string;
        type?: string;
        value?: string;
        region?: string;
        parentSelector?: string;
        depth?: number;
      }

      const elementToDataMap = new Map<Element, ElementData>();
      const seenElements = new Set<Element>();

      function detectRegion(el: Element): string {
        let current: Element | null = el;
        
        while (current) {
          const tagName = current.tagName?.toLowerCase();
          const role = current.getAttribute('role');
          const id = current.id?.toLowerCase();
          const className = current.className?.toString().toLowerCase();
          
          if (tagName === 'header' || role === 'banner' || id?.includes('header') || className?.includes('header')) {
            return 'header';
          }
          if (tagName === 'nav' || role === 'navigation' || id?.includes('nav') || className?.includes('nav')) {
            return 'nav';
          }
          if (tagName === 'aside' || role === 'complementary' || id?.includes('sidebar') || className?.includes('sidebar')) {
            return 'sidebar';
          }
          if (tagName === 'footer' || role === 'contentinfo' || id?.includes('footer') || className?.includes('footer')) {
            return 'footer';
          }
          if (tagName === 'main' || role === 'main' || id?.includes('main') || className?.includes('main-content')) {
            return 'main';
          }
          
          current = current.parentElement;
        }
        
        return 'main';
      }

      function findInteractiveParent(el: Element, elementToDataMap: Map<Element, ElementData>): string | undefined {
        let current = el.parentElement;
        
        while (current) {
          if (elementToDataMap.has(current)) {
            return elementToDataMap.get(current)!.selector;
          }
          current = current.parentElement;
        }
        
        return undefined;
      }

      function calculateDepth(el: Element): number {
        let depth = 0;
        let current = el.parentElement;
        
        while (current && current !== document.body) {
          depth++;
          current = current.parentElement;
        }
        
        return depth;
      }

      function generateSelector(el: Element): string {
        const htmlEl = el as HTMLElement;
        const tagName = el.tagName.toLowerCase();
        const ariaRole = el.getAttribute('role');
        const ariaLabel = el.getAttribute('aria-label');
        const placeholder = (htmlEl as HTMLInputElement).placeholder;
        const testId = el.getAttribute('data-testid');
        const contentEditable = htmlEl.contentEditable === 'true';
        const name = (htmlEl as HTMLInputElement).name;
        const type = (htmlEl as HTMLInputElement).type;
        const text = (el.textContent || '').trim().slice(0, 100);

        if (testId) {
          return `[data-testid="${testId}"]`;
        } else if (ariaLabel) {
          if (ariaRole) {
            return `${tagName}[aria-label="${ariaLabel}"]`;
          } else {
            return `[aria-label="${ariaLabel}"]`;
          }
        } else if (placeholder && (tagName === 'input' || tagName === 'textarea')) {
          return `${tagName}[placeholder="${placeholder}"]`;
        } else if (text && text.length > 0 && text.length <= 50 && (tagName === 'button' || tagName === 'a' || tagName === 'div' || tagName === 'span' || ariaRole === 'button' || ariaRole === 'link')) {
          const escapedText = text.replace(/"/g, '\\"');
          return `${tagName}:has-text("${escapedText}")`;
        } else if (contentEditable) {
          return `${tagName}[contenteditable="true"]`;
        } else if (ariaRole && (ariaRole === 'button' || ariaRole === 'link' || ariaRole === 'textbox' || ariaRole === 'checkbox' || ariaRole === 'radio')) {
          return `${tagName}[role="${ariaRole}"]`;
        } else if (name) {
          return `${tagName}[name="${name}"]`;
        } else {
          if (el.id) {
            return `${tagName}[id="${el.id}"]`;
          } else if (el.className && typeof el.className === 'string') {
            const classes = el.className.split(' ').filter((c: string) => c && !/^[0-9]/.test(c)).slice(0, 2).join('.');
            if (classes) {
              return `${tagName}.${classes}`;
            } else {
              return tagName;
            }
          } else {
            return tagName;
          }
        }
      }

      function processElement(el: Element): void {
        if (seenElements.has(el)) return;
        seenElements.add(el);

        const rect = el.getBoundingClientRect();
        const isVisible =
        rect.width > 0 &&
        rect.height > 0 &&
        window.getComputedStyle(el).visibility !== 'hidden' &&
        window.getComputedStyle(el).display !== 'none' &&
        window.getComputedStyle(el).opacity !== '0' &&
        window.getComputedStyle(el).pointerEvents !== 'none';

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
        const contentEditable = htmlEl.contentEditable === 'true';
        
        let role = ariaRole || tagName;
        if (tagName === 'input' && type) {
          role = type === 'text' || type === 'email' || type === 'password' || type === 'search' || type === 'tel' || type === 'url' ? 'textbox' : type;
        } else if (tagName === 'textarea') {
          role = 'textbox';
        } else if (contentEditable) {
          role = 'textbox';
        } else if ((tagName === 'div' || tagName === 'span') && window.getComputedStyle(el).cursor === 'pointer') {
          role = 'button';
        }

        const selector = generateSelector(el);
        const region = detectRegion(el);
        const depth = calculateDepth(el);

        const elementData: ElementData = {
          element: el,
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
          region,
          depth,
        };

        elementToDataMap.set(el, elementData);
      }

      interactiveSelectors.forEach((selectorType) => {
        const elements = document.querySelectorAll(selectorType);
        elements.forEach((el) => {
          processElement(el);
        });
      });

      const allElements = document.querySelectorAll('div, span');
      allElements.forEach((el) => {
        if (seenElements.has(el)) return;
        
        const computedStyle = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        
        const isClickable = computedStyle.cursor === 'pointer';
        const isReasonableSize = rect.width > 20 && rect.width < 500 && 
                                 rect.height > 20 && rect.height < 200;
        const text = (el.textContent || '').trim();
        const hasText = text.length > 0 && text.length < 100;
        
        if (isClickable && isReasonableSize && hasText) {
          processElement(el);
        }
      });

      elementToDataMap.forEach((data) => {
        data.parentSelector = findInteractiveParent(data.element, elementToDataMap);
      });

      const selectorToElement = new Map<string, ElementData>();
      elementToDataMap.forEach((data) => {
        if (!selectorToElement.has(data.selector)) {
          selectorToElement.set(data.selector, data);
        }
      });

      const results = Array.from(selectorToElement.values()).map(data => ({
        selector: data.selector,
        text: data.text,
        role: data.role,
        isVisible: data.isVisible,
        boundingBox: data.boundingBox,
        ariaLabel: data.ariaLabel,
        placeholder: data.placeholder,
        title: data.title,
        name: data.name,
        type: data.type,
        value: data.value,
        region: data.region,
        parentSelector: data.parentSelector,
        depth: data.depth,
      }));

      return results;
    });

    return elements;
  }
}

