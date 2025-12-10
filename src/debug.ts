#!/usr/bin/env node

/**
 * Debug script for testing Playwright functions
 * Usage: npm run debug (for Bing search)
 * Usage: npm run debug:zhihu (for Zhihu content fetch)
 */

import { searchBingWithBrowser } from './index.js';
import { chromium, Browser, BrowserContext, Page } from "playwright";
import * as cheerio from "cheerio";

/**
 * Setup Playwright page with comprehensive anti-detection measures
 * Based on puppeteer-extra-plugin-stealth techniques
 * @param {Page} page - Playwright page object
 */
async function setupAntiDetection(page: Page): Promise<void> {
  await page.addInitScript(() => {
    // 1. Remove webdriver property completely
    Object.defineProperty(navigator, 'webdriver', {
      get: () => false,
    });
    
    delete (navigator as any).__proto__.webdriver;

    // 2. Override userAgent
    Object.defineProperty(navigator, 'userAgent', {
      get: () =>
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    });

    // 3. Setup platform
    Object.defineProperty(navigator, 'platform', {
      get: () => 'MacIntel',
    });

    // 4. Setup languages
    Object.defineProperty(navigator, 'languages', {
      get: () => ['zh-CN', 'zh', 'en-US', 'en'],
    });

    // 5. Setup hardwareConcurrency
    Object.defineProperty(navigator, 'hardwareConcurrency', {
      get: () => 8,
    });

    // 6. Setup deviceMemory
    if (!(navigator as any).deviceMemory) {
      Object.defineProperty(navigator, 'deviceMemory', {
        get: () => 8,
      });
    }

    // 7. Setup window.chrome object
    (window as any).chrome = {
      app: {
        InstallState: 'hehe',
        RunningState: 'haha',
        getDetails: 'xixi',
        getIsInstalled: 'ohno',
      },
      csi: function () {
        return {
          startE: Date.now(),
          onloadT: Date.now(),
          pageT: Date.now() - performance.timing.navigationStart,
          tran: 15,
        };
      },
      loadTimes: function () {
        return {
          commitLoadTime: performance.timing.domContentLoadedEventStart / 1000,
          connectionInfo: 'http/1.1',
          finishDocumentLoadTime: performance.timing.domContentLoadedEventEnd / 1000,
          finishLoadTime: performance.timing.loadEventEnd / 1000,
          firstPaintAfterLoadTime: 0,
          firstPaintTime: performance.timing.responseStart / 1000,
          navigationType: 'Other',
          npnNegotiatedProtocol: 'unknown',
          requestTime: performance.timing.navigationStart / 1000,
          startLoadTime: performance.timing.navigationStart / 1000,
          wasAlternateProtocolAvailable: false,
          wasFetchedViaSpdy: false,
          wasNpnNegotiated: false,
        };
      },
      runtime: {
        connect: function () {
          return {
            onConnect: { addListener: function () {} },
            onMessage: { addListener: function () {} },
            postMessage: function () {},
            disconnect: function () {},
          };
        },
        sendMessage: function () {
          return Promise.resolve({});
        },
        onConnect: { addListener: function () {} },
        onMessage: { addListener: function () {} },
      },
    };

    // 8. Setup permissions API
    const originalQuery = (window.navigator.permissions as any).query;
    (window.navigator.permissions as any).query = (parameters: any) => {
      if (parameters.name === 'notifications') {
        return Promise.resolve({ state: Notification.permission });
      }
      return originalQuery ? originalQuery(parameters) : Promise.resolve({ state: 'granted' });
    };

    // 9. Setup WebGL vendor and renderer
    const getParameter = WebGLRenderingContext.prototype.getParameter;
    WebGLRenderingContext.prototype.getParameter = function (parameter: number) {
      if (parameter === 37445) {
        return 'Intel Inc.';
      }
      if (parameter === 37446) {
        return 'Intel(R) Iris(TM) Graphics 6100';
      }
      return getParameter.call(this, parameter);
    };

    // 10. Setup window.outerWidth and window.outerHeight
    const viewportWidth = window.innerWidth || 1920;
    const viewportHeight = window.innerHeight || 1080;
    Object.defineProperty(window, 'outerWidth', {
      get: () => viewportWidth,
    });
    Object.defineProperty(window, 'outerHeight', {
      get: () => viewportHeight,
    });

    // 11. Setup connection
    if (!(navigator as any).connection) {
      Object.defineProperty(navigator, 'connection', {
        get: () => ({
          effectiveType: '4g',
          rtt: 50,
          downlink: 10,
          saveData: false,
        }),
      });
    }
  });
}

/**
 * Extract text content from HTML using Cheerio
 * @param {string} html - HTML content
 * @returns {string} Extracted text content
 */
function extractTextContentFromHTML(html: string): string {
  const $ = cheerio.load(html);
  
  // Remove unwanted elements
  $('script, style, iframe, noscript, nav, header, footer, .header, .footer, .nav, .sidebar, .ad, .advertisement, #header, #footer, #nav, #sidebar').remove();
  
  // Try to find main content area
  let content = '';
  const mainSelectors = [
    'main', 'article', '.article', '.post', '.content', '#content', 
    '.main', '#main', '.body', '#body', '.entry', '.entry-content',
    '.post-content', '.article-content', '.text', '.detail'
  ];
  
  for (const selector of mainSelectors) {
    const mainElement = $(selector);
    if (mainElement.length > 0) {
      content = mainElement.text().trim();
      console.log(`使用选择器 "${selector}" 找到内容，长度: ${content.length} 字符`);
      break;
    }
  }
  
  // If no main content found, try extracting paragraphs
  if (!content || content.length < 100) {
    console.log('未找到主要内容区域，尝试提取所有段落');
    const paragraphs: string[] = [];
    $('p').each((_: number, element: any) => {
      const text = $(element).text().trim();
      if (text.length > 20) {
        paragraphs.push(text);
      }
    });
    
    if (paragraphs.length > 0) {
      content = paragraphs.join('\n\n');
      console.log(`从段落中提取到内容，长度: ${content.length} 字符`);
    }
  }
  
  // If still no content, get body content
  if (!content || content.length < 100) {
    console.log('从段落中未找到足够内容，获取body内容');
    content = $('body').text().trim();
  }
  
  // Clean text
  content = content
    .replace(/\s+/g, ' ')
    .replace(/\n+/g, '\n')
    .trim();
  
  // Add title
  const title = $('title').text().trim();
  if (title) {
    content = `标题: ${title}\n\n${content}`;
  }
  
  // Limit content length
  const maxLength = 8000;
  if (content.length > maxLength) {
    content = content.substring(0, maxLength) + '... (内容已截断)';
  }
  
  console.log(`最终提取内容长度: ${content.length} 字符`);
  return content;
}

/**
 * Debug function to fetch content from zhihu.com
 */
async function debugZhihu() {
  const url = 'https://www.zhihu.com';
  let browser: Browser | null = null;

  console.log('=== Debug: Fetching Zhihu.com Content with Playwright ===');
  console.log(`URL: ${url}`);
  console.log('');

  try {
    // Launch browser
    console.log('Launching Chromium browser...');
    browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu',
        '--disable-web-security',
        '--disable-features=IsolateOrigins,site-per-process',
        '--disable-site-isolation-trials',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
        '--disable-features=TranslateUI',
        '--disable-ipc-flooding-protection',
      ],
    });
    console.log('✅ Browser launched successfully');

    // Create context
    console.log('Creating browser context...');
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      locale: 'zh-CN',
      viewport: { width: 1920, height: 1080 },
    });
    console.log('✅ Browser context created successfully');

    // Create page
    console.log('Creating new page...');
    const page = await context.newPage();
    console.log('✅ New page created successfully');

    // Setup anti-detection measures
    await setupAntiDetection(page);
    console.log('✅ Anti-detection measures applied');

    // Navigate to zhihu.com
    console.log(`Navigating to ${url}...`);
    await page.goto(url, { 
      waitUntil: 'load', 
      timeout: 30000 
    });
    console.log('✅ Successfully navigated to Zhihu');
    
    // Wait for dynamic content to load
    await page.waitForTimeout(2000);

    // Get page HTML content
    const htmlContent = await page.content();
    console.log(`Retrieved HTML content, length: ${htmlContent.length} bytes`);
    console.log('');

    // Extract text content
    console.log('=== Extracting Text Content ===');
    const content = extractTextContentFromHTML(htmlContent);
    console.log('');

    // Display content preview
    console.log('=== Content Preview ===');
    console.log(content.substring(0, 500));
    if (content.length > 500) {
      console.log('...');
      console.log(`(Total length: ${content.length} characters)`);
    }
    console.log('');

    console.log('=== Debug Complete ===');
  } catch (error) {
    console.error('=== Error ===');
    console.error(error);
    process.exit(1);
  } finally {
    // Close browser
    if (browser) {
      await browser.close();
      console.log('Browser closed');
    }
  }
}

/**
 * Debug function for Bing search
 */
async function debugBing() {
  const query = "迫击炮 是什么";
  const numResults = 10;

  console.log('=== Debug: Starting Bing Search with Playwright ===');
  console.log(`Query: ${query}`);
  console.log(`Num Results: ${numResults}`);
  console.log('');

  try {
    // Set breakpoint here to debug step by step
    const results = await searchBingWithBrowser(query, numResults);

    console.log('=== Search Results ===');
    console.log(`Found ${results.length} results:`);
    console.log('');
    
    results.forEach((result, index) => {
      console.log(`Result ${index + 1}:`);
      console.log(`  ID: ${result.id}`);
      console.log(`  Title: ${result.title}`);
      console.log(`  Link: ${result.link}`);
      console.log(`  Snippet: ${result.snippet.substring(0, 100)}...`);
      console.log('');
    });

    console.log('=== Debug Complete ===');
  } catch (error) {
    console.error('=== Error ===');
    console.error(error);
    process.exit(1);
  }
}

// Check command line argument to determine which debug function to run
const args = process.argv.slice(2);
if (args.includes('--zhihu') || args.includes('-z')) {
  debugZhihu();
} else {
  debugBing();
}
