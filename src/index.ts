#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import axios from "axios";
import * as cheerio from "cheerio";
import dotenv from "dotenv";
// Playwright is imported but not used yet - will be used for future browser automation
import { chromium, Browser, BrowserContext, Page } from "playwright";
import { execSync } from "child_process";
import { extractBingSearchResults, SearchResult, SearchResultWithTimestamp } from "./bingParser.js";

// Check if Chromium browser is installed, install if not
let browserInstalled = false;
async function ensureBrowserInstalled(): Promise<void> {
  if (browserInstalled) return;
  
  try {
    // Try to launch browser to check if it's installed
    const browser = await chromium.launch({ headless: true });
    await browser.close();
    browserInstalled = true;
    console.error('Playwright Chromium browser is ready');
  } catch (error) {
    console.error('⚠️ Playwright Chromium browser not found. Attempting to install...');
    console.error('This may take a few minutes. Please wait...');
    
    // Try to install automatically
    try {
      execSync('npx playwright install chromium', { stdio: 'inherit' });
      browserInstalled = true;
      console.error('✅ Chromium browser installed successfully');
    } catch (installError) {
      console.error('❌ Failed to install Chromium automatically');
      console.error('Please manually run: npx playwright install chromium');
      throw new Error('Playwright Chromium browser is not installed. Please run: npx playwright install chromium');
    }
  }
}

// Load environment variables
dotenv.config();

// Default user agent - matches Mac Chrome to avoid headless detection
const USER_AGENT = process.env.USER_AGENT || "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/**
 * Generate a random MUID (Microsoft User ID) for cookies
 * @returns {string} Random MUID string
 */
function generateMUID(): string {
  const part1 = Math.random().toString(36).substring(2, 15);
  const part2 = Math.random().toString(36).substring(2, 15);
  return part1 + part2;
}

/**
 * Generate realistic browser headers to avoid detection
 * @param {string} referer - Referer URL
 * @param {boolean} isSearch - Whether this is a search request
 * @returns {Record<string, string>} Headers object
 */
function generateBrowserHeaders(referer?: string, isSearch: boolean = false): Record<string, string> {
  // Randomize Accept-Language slightly to avoid exact pattern matching
  const languageVariants = [
    'zh-CN,zh;q=0.9,en;q=0.8',
    'zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7',
    'zh-CN,zh;q=0.9',
  ];
  const acceptLanguage = languageVariants[Math.floor(Math.random() * languageVariants.length)];

  const headers: Record<string, string> = {
    'User-Agent': USER_AGENT,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
    'Accept-Language': acceptLanguage,
    'Accept-Encoding': 'gzip, deflate, br',
    'Cache-Control': isSearch ? 'no-cache' : 'max-age=0',
    'Connection': 'keep-alive',
    'Upgrade-Insecure-Requests': '1',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': referer && referer.includes('bing.com') ? 'same-origin' : (referer ? 'cross-site' : 'none'),
    'Sec-Fetch-User': '?1',
    'Sec-Ch-Ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
    'Sec-Ch-Ua-Mobile': '?0',
    'Sec-Ch-Ua-Platform': '"macOS"',
    'DNT': '1',
  };

  // Add Pragma only for search requests
  if (isSearch) {
    headers['Pragma'] = 'no-cache';
  }

  // Add Referer if provided
  if (referer) {
    headers['Referer'] = referer;
  }

  // Add cookies for Bing search with randomized MUID
  if (isSearch) {
    const muid = generateMUID();
    headers['Cookie'] = `SRCHHPGUSR=SRCHLANG=zh-Hans; _EDGE_S=ui=zh-cn; _EDGE_V=1; MUID=${muid}`;
  }

  return headers;
}

// Global variable to store search results, accessible by ID
// SearchResult and SearchResultWithTimestamp types are imported from bingParser.ts

const searchResults = new Map<string, SearchResultWithTimestamp>();

// Counter for generating unique IDs
let resultIdCounter = 0;

// Maximum number of results to keep in memory
const MAX_RESULTS = 1000;

// Result expiration time (1 hour in milliseconds)
const RESULT_EXPIRATION_MS = 60 * 60 * 1000;

/**
 * Clean up expired and old results from the Map
 */
function cleanupResults(): void {
  const now = Date.now();
  const entries = Array.from(searchResults.entries());
  
  // Remove expired results (older than 1 hour)
  for (const [id, result] of entries) {
    if (now - result.timestamp > RESULT_EXPIRATION_MS) {
      searchResults.delete(id);
    }
  }
  
  // If still too many results, remove oldest ones
  if (searchResults.size > MAX_RESULTS) {
    const sortedEntries = Array.from(searchResults.entries())
      .sort((a, b) => a[1].timestamp - b[1].timestamp);
    
    const toRemove = sortedEntries.slice(0, searchResults.size - MAX_RESULTS);
    for (const [id] of toRemove) {
      searchResults.delete(id);
    }
  }
}

/**
 * Generate a unique result ID
 */
function generateResultId(prefix: string = 'result'): string {
  resultIdCounter++;
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 9);
  return `${prefix}_${timestamp}_${resultIdCounter}_${random}`;
}


/**
 * Parse Bing search results from HTML content (with fallback handling)
 * @param {string} htmlContent - HTML content from Bing search page
 * @param {string} query - Search query string
 * @param {string} searchUrl - Original search URL
 * @param {number} numResults - Maximum number of results to return
 * @returns {Array<SearchResult>} Array of parsed search results
 */
function parseBingSearchResults(htmlContent: string, query: string, searchUrl: string, numResults: number): SearchResult[] {
  // Extract results from HTML using the parser module
  const results = extractBingSearchResults(
    htmlContent,
    numResults,
    generateResultId,
    (result) => {
      searchResults.set(result.id, result);
    },
    cleanupResults
  );
  
  // If still no results found, add a generic result
  if (results.length === 0) {
    console.error('No results found, adding original search link as result');
    
    const id = generateResultId('result_fallback');
    const result: SearchResultWithTimestamp = {
      id,
      title: `Search Results: ${query}`,
      link: searchUrl,
      snippet: `Unable to parse search results for "${query}", but you can visit the Bing search page directly.`,
      timestamp: Date.now()
    };
    
    searchResults.set(id, result);
    results.push(result);
  }
  
  return results;
}

/**
 * Launch browser with anti-detection settings (shared method)
 * @returns {Promise<Browser>} Launched browser instance
 */
async function launchBrowserWithAntiDetection(): Promise<Browser> {
  // Ensure browser is installed before launching
  await ensureBrowserInstalled();
  
  console.error('Launching Chromium browser...');
  try {
    const browser = await chromium.launch({
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
    console.error('✅ Browser launched successfully');
    return browser;
  } catch (error) {
    console.error('❌ Failed to launch browser:', error);
    throw new Error(`Failed to launch browser: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Create browser context with realistic settings (shared method)
 * @param {Browser} browser - Browser instance
 * @returns {Promise<BrowserContext>} Browser context
 */
async function createBrowserContext(browser: Browser): Promise<BrowserContext> {
  console.error('Creating browser context...');
  try {
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      locale: 'zh-CN',
      viewport: { width: 1920, height: 1080 },
    });
    console.error('✅ Browser context created successfully');
    return context;
  } catch (error) {
    console.error('❌ Failed to create browser context:', error);
    throw new Error(`Failed to create browser context: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
    }
    
/**
 * Create and setup page with anti-detection (shared method)
 * @param {BrowserContext} context - Browser context
 * @returns {Promise<Page>} Configured page
 */
async function createPageWithAntiDetection(context: BrowserContext): Promise<Page> {
  console.error('Creating new page...');
  let page: Page;
  try {
    page = await context.newPage();
    console.error('✅ New page created successfully');
  } catch (error) {
    console.error('❌ Failed to create new page:', error);
    throw new Error(`Failed to create new page: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }

  // Setup anti-detection measures
  await setupAntiDetection(page);
  
  return page;
}

/**
 * Extract text content from HTML using Cheerio (shared method)
 * @param {string} html - HTML content
 * @returns {string} Extracted text content
 */
function extractTextContentFromHTML(html: string): string {
    // Use Cheerio to parse HTML
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
      console.error(`使用选择器 "${selector}" 找到内容，长度: ${content.length} 字符`);
      break;
    }
  }
  
  // If no main content found, try extracting paragraphs
  if (!content || content.length < 100) {
    console.error('未找到主要内容区域，尝试提取所有段落');
    const paragraphs: string[] = [];
    $('p').each((_: number, element: any) => {
      const text = $(element).text().trim();
      if (text.length > 20) {
        paragraphs.push(text);
      }
    });
    
    if (paragraphs.length > 0) {
      content = paragraphs.join('\n\n');
      console.error(`从段落中提取到内容，长度: ${content.length} 字符`);
    }
  }
  
  // If still no content, get body content
  if (!content || content.length < 100) {
    console.error('从段落中未找到足够内容，获取body内容');
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
  
  console.error(`最终提取内容长度: ${content.length} 字符`);
  return content;
}

/**
 * Setup Playwright page with comprehensive anti-detection measures
 * Based on puppeteer-extra-plugin-stealth techniques
 * @param {Page} page - Playwright page object
 */
async function setupAntiDetection(page: Page): Promise<void> {
  // Comprehensive anti-detection script (all in one to ensure proper execution order)
  await page.addInitScript(() => {
    // 1. Remove webdriver property completely
    Object.defineProperty(navigator, 'webdriver', {
      get: () => false,
    });
    
    // Also delete from prototype chain
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

    // 5. Setup hardwareConcurrency (CPU cores)
    Object.defineProperty(navigator, 'hardwareConcurrency', {
      get: () => 8,
    });

    // 6. Setup deviceMemory (if available)
    if (!(navigator as any).deviceMemory) {
      Object.defineProperty(navigator, 'deviceMemory', {
        get: () => 8,
      });
        }
        
    // 7. Setup plugins with realistic structure
    const createPlugin = (name: string, filename: string, description: string, mimeTypes: any[]) => {
      const plugin = {
        name,
        filename,
        description,
        length: mimeTypes.length,
      };
      mimeTypes.forEach((mimeType, index) => {
        (plugin as any)[index] = mimeType;
      });
      return plugin;
    };

    const createMimeType = (type: string, suffixes: string, description: string) => {
      return {
        type,
        suffixes,
        description,
        enabledPlugin: {},
      };
    };

    Object.defineProperty(navigator, 'plugins', {
      get: () => {
        return [
          createPlugin(
            'Chrome PDF Plugin',
            'internal-pdf-viewer',
            'Portable Document Format',
            [createMimeType('application/x-google-chrome-pdf', 'pdf', 'Portable Document Format')]
          ),
          createPlugin(
            'Chrome PDF Viewer',
            'mhjfbmdgcfjbbpaeojofohoefgiehjai',
            '',
            [createMimeType('application/pdf', 'pdf', '')]
          ),
          createPlugin(
            'Native Client',
            'internal-nacl-plugin',
            '',
            [
              createMimeType('application/x-nacl', '', 'Native Client Executable'),
              createMimeType('application/x-pnacl', '', 'Portable Native Client Executable'),
            ]
          ),
        ];
      },
    });

    // 8. Setup mimeTypes
    Object.defineProperty(navigator, 'mimeTypes', {
      get: () => {
        const mimeTypes: any[] = [];
        const plugins = navigator.plugins as any;
        for (let i = 0; i < plugins.length; i++) {
          const plugin = plugins[i];
          for (let j = 0; j < plugin.length; j++) {
            mimeTypes.push(plugin[j]);
          }
        }
        return mimeTypes;
      },
    });

    // 9. Setup window.chrome object with comprehensive properties
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

    // 10. Setup permissions API
    const originalQuery = (window.navigator.permissions as any).query;
    (window.navigator.permissions as any).query = (parameters: any) => {
      if (parameters.name === 'notifications') {
        return Promise.resolve({ state: Notification.permission });
      }
      return originalQuery ? originalQuery(parameters) : Promise.resolve({ state: 'granted' });
    };

    // 11. Setup WebGL vendor and renderer
    const getParameter = WebGLRenderingContext.prototype.getParameter;
    WebGLRenderingContext.prototype.getParameter = function (parameter: number) {
      // UNMASKED_VENDOR_WEBGL (0x9245)
      if (parameter === 37445) {
        return 'Intel Inc.';
      }
      // UNMASKED_RENDERER_WEBGL (0x9246)
      if (parameter === 37446) {
        return 'Intel(R) Iris(TM) Graphics 6100';
      }
      return getParameter.call(this, parameter);
    };
        
    // Also for WebGL2
    if (typeof WebGL2RenderingContext !== 'undefined') {
      const getParameter2 = WebGL2RenderingContext.prototype.getParameter;
      WebGL2RenderingContext.prototype.getParameter = function (parameter: number) {
        if (parameter === 37445) {
          return 'Intel Inc.';
        }
        if (parameter === 37446) {
          return 'Intel(R) Iris(TM) Graphics 6100';
        }
        return getParameter2.call(this, parameter);
      };
        }
        
    // 12. Setup window.outerWidth and window.outerHeight (match viewport)
    const viewportWidth = window.innerWidth || 1920;
    const viewportHeight = window.innerHeight || 1080;
    Object.defineProperty(window, 'outerWidth', {
      get: () => viewportWidth,
    });
    Object.defineProperty(window, 'outerHeight', {
      get: () => viewportHeight,
    });

    // 13. Remove automation indicators from toString
    const originalToString = Function.prototype.toString;
    Function.prototype.toString = function () {
      if (this === navigator.permissions.query || this === WebGLRenderingContext.prototype.getParameter) {
        return 'function () { [native code] }';
      }
      return originalToString.call(this);
    };

    // 14. Setup connection (if available)
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
        
    // 15. Override toString to hide automation
    const originalNavigatorToString = navigator.toString;
    navigator.toString = function () {
      return '[object Navigator]';
    };
  });
}

/**
 * Search Bing using Playwright browser automation
 * @param {string} query - Search query string
 * @param {number} numResults - Maximum number of results to return
 * @returns {Promise<Array<SearchResult>>} Array of search results
 */
export async function searchBingWithBrowser(query: string, numResults: number): Promise<SearchResult[]> {
  let browser: Browser | null = null;
  try {
    console.error(`Starting browser search for: ${query}`);
    
    // Use shared methods to launch browser and create page
    browser = await launchBrowserWithAntiDetection();
    const context = await createBrowserContext(browser);
    const page = await createPageWithAntiDetection(context);

    // First, open about:blank to test if browser works
    console.error('Testing browser by opening about:blank...');
    try {
      await page.goto('about:blank', { waitUntil: 'domcontentloaded', timeout: 10000 });
      console.error('✅ Browser opened successfully');
      await page.waitForTimeout(1000); // Wait 1 second
    } catch (error) {
      console.error('❌ Failed to open about:blank:', error);
      throw new Error(`Browser failed to open: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
        
    // Navigate to Bing homepage
    console.error('Navigating to www.bing.com/?mkt=zh-CN...');
    try {
      // Use 'load' instead of 'networkidle' - waits for page load event, not network idle
      // This is faster and more reliable for modern web pages
      await page.goto('https://www.bing.com/?mkt=zh-CN', { waitUntil: 'load', timeout: 30000 });
      console.error('✅ Successfully navigated to Bing');
      // Wait a bit for any dynamic content to load
      await page.waitForTimeout(1000);
    } catch (error) {
      console.error('❌ Failed to navigate to Bing:', error);
      throw new Error(`Failed to navigate to Bing: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
    
    // Random delay to simulate human behavior (500-1500ms)
    await page.waitForTimeout(Math.random() * 1000 + 500);

    // Find search input box (common selectors for Bing search)
    const searchInputSelectors = [
      'input[name="q"]',
      'input[type="search"]',
      '#sb_form_q',
      'input#sb_form_q',
      '.b_searchboxForm input',
    ];

    let searchInput = null;
    for (const selector of searchInputSelectors) {
          try {
        searchInput = await page.$(selector);
        if (searchInput) {
          console.error(`Found search input with selector: ${selector}`);
          break;
        }
          } catch (e) {
        // Continue to next selector
      }
    }

    if (!searchInput) {
      throw new Error('Could not find Bing search input box');
        }
        
    // Click on search input to focus
    await searchInput.click();
    await page.waitForTimeout(Math.random() * 300 + 200); // 200-500ms delay

    // Type search query character by character to simulate human typing
    console.error(`Typing search query: ${query}`);
    await searchInput.type(query, { delay: Math.random() * 100 + 50 }); // 50-150ms delay between keystrokes
    
    // Random delay before pressing Enter (300-800ms)
    await page.waitForTimeout(Math.random() * 500 + 300);

    // Press Enter to search
    console.error('Pressing Enter to search...');
    await page.keyboard.press('Enter');

    // Wait for search results to load
    console.error('Waiting for search results...');
    await page.waitForSelector('#b_results, .b_algo, #b_content', { timeout: 15000 });
        
    // Additional wait for content to fully load
    await page.waitForTimeout(1000 + Math.random() * 500);

    // Get page HTML content
    const htmlContent = await page.content();
    console.error(`Retrieved HTML content, length: ${htmlContent.length} bytes`);

    // Check if blocked by anti-bot
    const htmlContentLower = htmlContent.toLowerCase();
    const botDetectionKeywords = [
      'captcha',
      'verification',
      'verify you are human',
      'access denied',
      'blocked',
      'rate limit',
      'too many requests',
      '请验证',
      '验证码',
      '人机验证'
    ];
      
    // Check for bot detection keywords and log them, but don't throw error
    const detectedKeywords = botDetectionKeywords.filter(keyword => htmlContentLower.includes(keyword));
    if (detectedKeywords.length > 0) {
      console.error(`⚠️ Warning: Possible bot detection keywords detected: ${detectedKeywords.join(', ')}`);
    }
    
    // Check if response contains search results structure
    if (!htmlContentLower.includes('b_results') && !htmlContentLower.includes('b_algo')) {
      console.error('⚠️ Warning: Response does not contain expected search result structure');
      throw new Error('Bing返回的页面不包含预期的搜索结果结构，可能是错误页面或被阻止。');
    }

    // Get current URL after search
    const searchUrl = page.url();
    console.error(`Search completed, URL: ${searchUrl}`);

    // Parse search results from HTML
    const results = parseBingSearchResults(htmlContent, query, searchUrl, numResults);
    
    return results;
  } catch (error) {
    console.error('Browser search error:', error);
    throw error;
  } finally {
    // Close browser
    if (browser) {
      await browser.close();
      console.error('Browser closed');
    }
  }
}

/**
 * 必应搜索函数 (using axios)
 * @param {string} query - 搜索关键词
 * @param {number} numResults - 返回结果数量
 * @returns {Promise<Array<SearchResult>>} 搜索结果数组
 */
export async function searchBing(query: string, numResults: number): Promise<SearchResult[]> {
  try {
    // Build Bing search URL with Chinese support parameters
    const searchUrl = `https://cn.bing.com/search?q=${encodeURIComponent(query)}&setlang=zh-CN&ensearch=0`;
    console.error(`正在搜索URL: ${searchUrl}`);
    
    // Generate realistic browser headers
    const headers = generateBrowserHeaders(undefined, true);
        
    // Add random delay to avoid detection (300-1200ms) - more realistic human behavior
    const delay = Math.random() * 900 + 300;
    await new Promise(resolve => setTimeout(resolve, delay));
    
    // Send request
    const response = await axios.get(searchUrl, { 
      headers,
      timeout: 15000
    });
    console.error(`Search response status: ${response.status}`);
    
    // Debug: Log response content
    console.error(`Response content length: ${response.data.length} bytes`);
    const snippetSize = 200;
    console.error(`Response content first ${snippetSize} chars: ${response.data.substring(0, snippetSize)}`);
    
    // Check if response is valid or blocked by anti-bot
    const htmlContent = response.data.toLowerCase();
    
    // Detect common anti-bot responses
    const botDetectionKeywords = [
      'captcha',
      'verification',
      'verify you are human',
      'access denied',
      'blocked',
      'rate limit',
      'too many requests',
      '请验证',
      '验证码',
      '人机验证'
    ];
    
    const isBlocked = botDetectionKeywords.some(keyword => htmlContent.includes(keyword));
    if (isBlocked) {
      console.error('⚠️ Warning: Possible bot detection or CAPTCHA page detected');
      throw new Error('Bing可能检测到自动化请求，返回了验证页面。请稍后重试或检查请求频率。');
    }
    
    // Check if response contains search results structure
    if (!htmlContent.includes('b_results') && !htmlContent.includes('b_algo')) {
      console.error('⚠️ Warning: Response does not contain expected search result structure');
      // Log more details for debugging
      console.error(`Response preview: ${response.data.substring(0, 500)}`);
      throw new Error('Bing返回的页面不包含预期的搜索结果结构，可能是错误页面或被阻止。');
    }
    
    // Parse Bing search results from HTML
    const results = parseBingSearchResults(response.data, query, searchUrl, numResults);
    return results;
  } catch (error) {
    console.error('必应搜索出错:', error);
    if (axios.isAxiosError(error)) {
      console.error(`HTTP错误状态码: ${error.response?.status}`);
      console.error(`错误响应数据: ${JSON.stringify(error.response?.data || '无数据')}`);
    }
    
    // 出错时返回一个错误信息作为结果
    const id = generateResultId('error');
    const errorResult: SearchResultWithTimestamp = {
      id,
      title: `搜索 "${query}" 时出错`,
      link: `https://cn.bing.com/search?q=${encodeURIComponent(query)}`,
      snippet: `搜索过程中发生错误: ${error instanceof Error ? error.message : '未知错误'}`,
      timestamp: Date.now()
    };
    
    searchResults.set(id, errorResult);
    return [errorResult];
  }
}

/**
 * Fetch webpage content using Playwright browser automation
 * @param {string} resultId - Search result ID
 * @returns {Promise<string>} Webpage content
 */
async function fetchWebpageContent(resultId: string): Promise<string> {
  let browser: Browser | null = null;
  try {
    // Clean up old results before fetching
    cleanupResults();
    
    // Get URL from search results map
    const result = searchResults.get(resultId);
    if (!result) {
      throw new Error(`找不到ID为 ${resultId} 的搜索结果`);
    }
    
    const url = result.link;
    console.error(`正在获取网页内容: ${url}`);
    
    // Use shared methods to launch browser and create page
    browser = await launchBrowserWithAntiDetection();
    const context = await createBrowserContext(browser);
    const page = await createPageWithAntiDetection(context);
    
    // Determine referer for the page
    let referer = 'https://cn.bing.com/';
    try {
      const urlObj = new URL(url);
      // If it's a Bing URL, use same-origin referer
      if (urlObj.hostname.includes('bing.com')) {
        referer = `${urlObj.protocol}//${urlObj.hostname}/`;
      }
    } catch (e) {
      // Keep default Referer if URL parsing fails
    }
    
    // Add random delay to simulate human behavior (500-1500ms)
    await page.waitForTimeout(Math.random() * 1000 + 500);
    
    // Navigate to the webpage
    console.error(`Navigating to: ${url}`);
    try {
      await page.goto(url, { 
        waitUntil: 'load', 
        timeout: 30000,
        referer: referer
      });
      console.error('✅ Successfully navigated to webpage');
      // Wait a bit for dynamic content to load
      await page.waitForTimeout(1000 + Math.random() * 500);
    } catch (error) {
      console.error('❌ Failed to navigate to webpage:', error);
      throw new Error(`Failed to navigate to webpage: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
    
    // Get page HTML content
    const htmlContent = await page.content();
    console.error(`Retrieved HTML content, length: ${htmlContent.length} bytes`);
    
    // Extract text content from HTML using shared method
    const content = extractTextContentFromHTML(htmlContent);
    
    return content;
  } catch (error) {
    console.error('Error fetching webpage content:', error);
    throw new Error(`获取网页内容失败: ${error instanceof Error ? error.message : '未知错误'}`);
  } finally {
    // Close browser
    if (browser) {
      await browser.close();
      console.error('Browser closed');
    }
  }
}

// Create MCP server instance
const server = new McpServer({
  name: "bing-search",
  version: "2.0.9"
});

// Register Bing search tool
server.tool(
  "bing_search",
  {
    query: z.string().describe("搜索关键词"),
    num_results: z.number().default(5).describe("返回的结果数量，默认为5")
  },
  async ({ query, num_results }) => {
    try {
      // Use browser-based search for better anti-detection
      const results = await searchBingWithBrowser(query, num_results);
      
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(results, null, 2)
          }
        ]
      };
    } catch (error) {
      console.error('搜索出错:', error);
      return {
        content: [
          {
            type: "text",
            text: `搜索失败: ${error instanceof Error ? error.message : '未知错误'}`
          }
        ]
      };
    }
  }
);

// Register webpage content fetching tool
server.tool(
  "fetch_webpage",
  {
    result_id: z.string().describe("从bing_search返回的结果ID")
  },
  async ({ result_id }) => {
    try {
      // 获取网页内容
      const content = await fetchWebpageContent(result_id);
      
      return {
        content: [
          {
            type: "text",
            text: content
          }
        ]
      };
    } catch (error) {
      console.error('获取网页内容出错:', error);
      return {
        content: [
          {
            type: "text",
            text: `获取网页内容失败: ${error instanceof Error ? error.message : '未知错误'}`
          }
        ]
      };
    }
  }
);

// Run server
async function main() {
  try {
    // Pre-check browser installation (non-blocking)
    ensureBrowserInstalled().catch((error) => {
      console.error('Browser installation check failed (will retry on first use):', error);
    });
    
    // Set up periodic cleanup (every 30 minutes)
    setInterval(() => {
      cleanupResults();
      console.error(`Cleaned up results. Current Map size: ${searchResults.size}`);
    }, 30 * 60 * 1000);
    
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("必应搜索 MCP 服务器已启动");
  } catch (error) {
    console.error("服务器启动失败:", error);
    process.exit(1);
  }
}

main();