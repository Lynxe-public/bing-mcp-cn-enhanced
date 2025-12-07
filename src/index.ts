#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import axios from "axios";
import * as cheerio from "cheerio";
import dotenv from "dotenv";

// 加载环境变量
dotenv.config();

// 配置默认用户代理
const USER_AGENT = process.env.USER_AGENT || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// 定义搜索结果类型
interface SearchResult {
  id: string;
  title: string;
  link: string;
  snippet: string;
}

// 全局变量存储搜索结果，这样可以通过ID引用
const searchResults = new Map<string, SearchResult>();

/**
 * 必应搜索函数
 * @param {string} query - 搜索关键词
 * @param {number} numResults - 返回结果数量
 * @returns {Promise<Array<SearchResult>>} 搜索结果数组
 */
async function searchBing(query: string, numResults: number): Promise<SearchResult[]> {
  try {
    // 构建必应搜索URL，添加中文支持参数
    const searchUrl = `https://cn.bing.com/search?q=${encodeURIComponent(query)}&setlang=zh-CN&ensearch=0`;
    console.error(`正在搜索URL: ${searchUrl}`);
    
    // 设置请求头，模拟浏览器
    const headers = {
      'User-Agent': USER_AGENT,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',
      'Upgrade-Insecure-Requests': '1',
      'Cookie': 'SRCHHPGUSR=SRCHLANG=zh-Hans; _EDGE_S=ui=zh-cn; _EDGE_V=1'
    };
    
    // 发送请求
    const response = await axios.get(searchUrl, { 
      headers,
      timeout: 15000 // 增加超时时间
    });
    console.error(`搜索响应状态: ${response.status}`);
    
    // 调试：保存响应内容到日志
    console.error(`响应内容长度: ${response.data.length} 字节`);
    const snippetSize = 200;
    console.error(`响应内容前 ${snippetSize} 字符: ${response.data.substring(0, snippetSize)}`);
    
    // 使用 Cheerio 解析 HTML
    const $ = cheerio.load(response.data);
    
    // 找到搜索结果列表
    const results: SearchResult[] = [];
    
    // Debug: Print the number of search result elements found on the page
    const totalElements = $('#b_results > li').length;
    console.error(`Found ${totalElements} search result elements (b_results > li)`);
    
    // Check specific elements
    ['#b_results', '#b_topw', '.b_algo', '.b_ans', '.b_tpcn', '.b_title', '.b_caption', 'h2 a'].forEach(selector => {
      const count = $(selector).length;
      console.error(`Selector ${selector} matched ${count} elements`);
    });
    
    // Updated selector list, optimized for Chinese Bing results
    const resultSelectors = [
      '#b_results > li.b_algo',
      '#b_results > li.b_ans',
      '#b_results > li:not(.b_ad):not(.b_pag):not(.b_msg)',
      '#b_topw > li.b_algo',
      '#b_topw > li.b_ans'
    ];
    
    for (const selector of resultSelectors) {
      console.error(`尝试选择器: ${selector}`);
      $(selector).each((index: number, element: any) => {
        if (results.length >= numResults) return false;
        
        // Print element HTML for debugging
        const elementHtml = $(element).html()?.substring(0, 200);
        console.error(`Element ${index} HTML snippet: ${elementHtml}`);
        
        // Debug: Check what selectors match inside this element
        console.error(`  - h2 a: ${$(element).find('h2 a').length}`);
        console.error(`  - .b_tpcn: ${$(element).find('.b_tpcn').length}`);
        console.error(`  - .tptt: ${$(element).find('.tptt').length}`);
        console.error(`  - a.tilk: ${$(element).find('a.tilk').length}`);
        console.error(`  - .b_caption: ${$(element).find('.b_caption').length}`);
        
        // Try multiple ways to extract title and link
        let title = '';
        let link = '';
        
        // Method 1: Look for h2 a (standard result structure)
        const titleElement = $(element).find('h2 a').first();
        if (titleElement.length) {
          title = titleElement.text().trim();
          link = titleElement.attr('href') || '';
        }
        
        // Method 2: Look for .b_tpcn structure (new Bing layout)
        if (!title || !link) {
          const tpcnElement = $(element).find('.b_tpcn').first();
          if (tpcnElement.length) {
            // Title is in .tptt inside .tilk
            const tpttElement = tpcnElement.find('.tptt').first();
            if (tpttElement.length) {
              title = tpttElement.text().trim();
            }
            // Link is in .tilk - check href, redirecturl, or data-h attribute
            const tilkElement = tpcnElement.find('a.tilk').first();
            if (tilkElement.length) {
              link = tilkElement.attr('href') || 
                     tilkElement.attr('redirecturl') || 
                     tilkElement.attr('data-h') || 
                     link;
            }
          }
        }
        
        // Method 3: Try other selectors
        if (!title || !link) {
          const altTitleElement = $(element).find('.b_title a, a.tilk, h2 a, a[target="_blank"]').first();
          if (altTitleElement.length) {
            if (!title) {
              // Try to get title from text or from nested elements
              title = altTitleElement.text().trim() || 
                      altTitleElement.find('.tptt, strong').first().text().trim() || '';
            }
            if (!link) {
              link = altTitleElement.attr('href') || 
                     altTitleElement.attr('redirecturl') || 
                     altTitleElement.attr('data-h') || '';
            }
          }
        }
        
        // Method 4: Try to extract from h2 directly if still missing
        if (!title) {
          const h2Element = $(element).find('h2').first();
          if (h2Element.length) {
            title = h2Element.text().trim();
            // Try to find link near h2
            const h2Link = h2Element.find('a').first();
            if (h2Link.length && !link) {
              link = h2Link.attr('href') || '';
            }
          }
        }
        
        // Extract snippet
        let snippet = '';
        // Method 1: Look for .b_caption with p or direct text
        const captionElement = $(element).find('.b_caption').first();
        if (captionElement.length) {
          // Try to get text from p tags first
          const captionP = captionElement.find('p').first();
          if (captionP.length) {
            snippet = captionP.text().trim();
          } else {
            // If no p tag, get direct text
            snippet = captionElement.text().trim();
          }
        }
        
        // Method 2: Look for .b_snippet or .b_lineclamp2
        if (!snippet) {
          const snippetElement = $(element).find('.b_snippet, .b_lineclamp2, .b_lineclamp3').first();
          if (snippetElement.length) {
            snippet = snippetElement.text().trim();
          }
        }
        
        // Method 3: Extract from entire element if still no snippet
        if (!snippet) {
          snippet = $(element).text().trim();
          // Remove title part
          if (title && snippet.includes(title)) {
            snippet = snippet.replace(title, '').trim();
          }
          // Limit snippet length
          if (snippet.length > 200) {
            snippet = snippet.substring(0, 200) + '...';
          }
        }
        
        // Fix incomplete links
        if (link && !link.startsWith('http')) {
          // Handle Bing redirect URLs
          if (link.startsWith('/newtabredir') || link.startsWith('/ck/a')) {
            // These are Bing redirect URLs, skip them as they're not direct result links
            console.error(`Skipping Bing redirect URL: ${link}`);
            link = '';
          } else if (link.startsWith('/')) {
            link = `https://cn.bing.com${link}`;
          } else if (link.startsWith('//')) {
            link = `https:${link}`;
          } else {
            link = `https://cn.bing.com/${link}`;
          }
        }
        
        // Clean up link - remove tracking parameters
        if (link) {
          try {
            const url = new URL(link);
            // Remove common tracking parameters
            ['utm_source', 'utm_medium', 'utm_campaign', 'ref', 'source'].forEach(param => {
              url.searchParams.delete(param);
            });
            link = url.toString();
          } catch (e) {
            // If URL parsing fails, keep original link
            console.error(`Failed to parse URL: ${link}`);
          }
        }
        
        // Skip if it's an ad
        if ($(element).hasClass('b_ad') || $(element).closest('.b_ad').length > 0) {
          console.error(`Skipping ad element ${index}`);
          return;
        }
        
        // Skip pagination and message elements
        if ($(element).hasClass('b_pag') || $(element).hasClass('b_msg')) {
          console.error(`Skipping pagination/message element ${index}`);
          return;
        }
        
        // If we have a link but no title, try to extract from link text or use a default
        if (!title && link) {
          try {
            const urlObj = new URL(link);
            title = `Result from ${urlObj.hostname}`;
          } catch (e) {
            // If link is not a valid URL, try to extract from element text
            const elementText = $(element).text().trim().substring(0, 100);
            title = elementText || `Search Result ${index + 1}`;
          }
        }
        
        // If we still don't have a title, try to get it from the element's text
        if (!title) {
          const elementText = $(element).find('h2, h3, .b_title, .tptt').first().text().trim();
          if (elementText) {
            title = elementText.substring(0, 200);
          } else {
            // Last resort: use first 50 chars of element text
            title = $(element).text().trim().substring(0, 50) || `Result ${index + 1}`;
          }
        }
        
        // Skip only if we have absolutely nothing useful
        if (!title && !link && !snippet) {
          console.error(`Skipping element ${index} - no title, link, or snippet found`);
          return;
        }
        
        // 创建唯一ID
        const id = `result_${Date.now()}_${index}`;
        
        // Debug output
        console.error(`Found result ${index}: title="${title.substring(0, 50)}", link="${link.substring(0, 50)}..."`);
        
        // Check for duplicates by link
        const isDuplicate = results.some(r => r.link === link && link);
        if (isDuplicate) {
          console.error(`Skipping duplicate result with link: ${link.substring(0, 50)}`);
          return;
        }
        
        // Save to result map
        const result: SearchResult = { id, title, link, snippet };
        searchResults.set(id, result);
        
        results.push(result);
      });
      
      // Continue trying other selectors if we haven't found enough results yet
      if (results.length >= numResults) {
        console.error(`Found enough results (${results.length}), stopping search`);
        break;
      } else if (results.length > 0) {
        console.error(`Using selector ${selector} found ${results.length} results, continuing to try other selectors`);
      }
    }
    
    // If still no results found, try extracting from any links that look like search results
    if (results.length === 0) {
      console.error('No results found with selectors, trying to extract from links directly');
      
      // Try to find links in result-like containers
      const linkContainers = $('#b_results a[href], #b_topw a[href], .b_algo a[href], .b_ans a[href]');
      console.error(`Found ${linkContainers.length} potential result links`);
      
      linkContainers.each((index: number, element: any) => {
        if (results.length >= numResults) return false;
        
        const $el = $(element);
        let title = $el.text().trim();
        let link = $el.attr('href') || $el.attr('redirecturl') || $el.attr('data-h') || '';
        
        // Skip navigation links, empty links, or JavaScript links
        if (!link || link === '#' || link.startsWith('javascript:') || link.includes('/search?')) return;
        
        // Ensure link is a complete URL
        let fullLink = link;
        if (!link.startsWith('http')) {
          if (link.startsWith('/')) {
            fullLink = `https://cn.bing.com${link}`;
          } else {
            fullLink = `https://cn.bing.com/${link}`;
          }
        }
        
        // Skip Bing internal links
        if (fullLink.includes('bing.com/search') || fullLink.includes('bing.com/ck')) return;
        
        // If no title, try to get from parent elements
        if (!title || title.length < 3) {
          title = $el.closest('li, .b_algo, .b_ans').find('h2, .tptt, .b_title').first().text().trim() || 
                  $el.closest('li, .b_algo, .b_ans').find('h2').first().text().trim() || 
                  `Result ${index + 1}`;
        }
        
        // Get snippet from nearby elements
        let snippet = $el.closest('li, .b_algo, .b_ans').find('.b_caption, .b_snippet, .b_lineclamp2').first().text().trim();
        if (!snippet) {
          snippet = `Result from ${new URL(fullLink).hostname}`;
        }
        
        const id = `result_${Date.now()}_link_${index}`;
        console.error(`Extracted potential result link: ${title.substring(0, 50)} - ${fullLink.substring(0, 50)}`);
        
        const result: SearchResult = { id, title: title.substring(0, 200), link: fullLink, snippet: snippet.substring(0, 300) };
        searchResults.set(id, result);
        results.push(result);
      });
    }
    
    // If still no results found, add a generic result
    if (results.length === 0) {
      console.error('No results found, adding original search link as result');
      
      const id = `result_${Date.now()}_fallback`;
      const result: SearchResult = {
        id,
        title: `Search Results: ${query}`,
        link: searchUrl,
        snippet: `Unable to parse search results for "${query}", but you can visit the Bing search page directly.`
      };
      
      searchResults.set(id, result);
      results.push(result);
    }
    
    console.error(`Final: returning ${results.length} results`);
    return results;
  } catch (error) {
    console.error('必应搜索出错:', error);
    if (axios.isAxiosError(error)) {
      console.error(`HTTP错误状态码: ${error.response?.status}`);
      console.error(`错误响应数据: ${JSON.stringify(error.response?.data || '无数据')}`);
    }
    
    // 出错时返回一个错误信息作为结果
    const id = `error_${Date.now()}`;
    const errorResult: SearchResult = {
      id,
      title: `搜索 "${query}" 时出错`,
      link: `https://cn.bing.com/search?q=${encodeURIComponent(query)}`,
      snippet: `搜索过程中发生错误: ${error instanceof Error ? error.message : '未知错误'}`
    };
    
    searchResults.set(id, errorResult);
    return [errorResult];
  }
}

/**
 * 获取网页内容函数
 * @param {string} resultId - 搜索结果ID
 * @returns {Promise<string>} 网页内容
 */
async function fetchWebpageContent(resultId: string): Promise<string> {
  try {
    // 从搜索结果映射中获取URL
    const result = searchResults.get(resultId);
    if (!result) {
      throw new Error(`找不到ID为 ${resultId} 的搜索结果`);
    }
    
    const url = result.link;
    console.error(`正在获取网页内容: ${url}`);
    
    // Set request headers to mimic a real browser
    const headers: Record<string, string> = {
      'User-Agent': USER_AGENT,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
      'Accept-Language': 'zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7',
      'Accept-Encoding': 'gzip, deflate, br',
      'Cache-Control': 'max-age=0',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',
      'Referer': 'https://cn.bing.com/',
      'DNT': '1'
    };
    
    // Try to extract domain from URL for better Referer
    try {
      const urlObj = new URL(url);
      headers['Referer'] = `${urlObj.protocol}//${urlObj.hostname}/`;
    } catch (e) {
      // Keep default Referer if URL parsing fails
    }
    
    // Send request to fetch webpage content
    // Add a small random delay to avoid being detected as a bot
    const delay = Math.random() * 500 + 200; // 200-700ms delay
    await new Promise(resolve => setTimeout(resolve, delay));
    
    const response = await axios.get(url, { 
      headers,
      timeout: 20000,
      responseType: 'arraybuffer', // Use arraybuffer to handle various encodings
      maxRedirects: 5,
      validateStatus: (status) => status < 500 // Don't throw on 4xx errors, we'll handle them
    });
    
    console.error(`Webpage response status: ${response.status}`);
    
    // Handle 403 and other client errors
    if (response.status === 403) {
      throw new Error(`获取网页内容失败: 网站拒绝了访问请求 (403 Forbidden). 这可能是因为反爬虫机制。URL: ${url}`);
    }
    
    if (response.status >= 400) {
      throw new Error(`获取网页内容失败: HTTP ${response.status} 错误. URL: ${url}`);
    }
    
    // 检测编码并正确解码内容
    let html = '';
    const contentType = response.headers['content-type'] || '';
    let encoding = 'utf-8';
    
    // 从Content-Type头部尝试获取字符集
    const charsetMatch = contentType.match(/charset=([^;]+)/i);
    if (charsetMatch && charsetMatch[1]) {
      encoding = charsetMatch[1].trim();
      console.error(`从Content-Type检测到编码: ${encoding}`);
    }
    
    try {
      // 尝试使用检测到的编码解码
      const decoder = new TextDecoder(encoding);
      html = decoder.decode(response.data);
    } catch (decodeError) {
      console.error(`使用 ${encoding} 解码失败，回退到UTF-8: ${decodeError}`);
      // 如果解码失败，回退到UTF-8
      const decoder = new TextDecoder('utf-8');
      html = decoder.decode(response.data);
    }
    
    // 使用 Cheerio 解析 HTML
    const $ = cheerio.load(html);
    
    // 移除不需要的元素
    $('script, style, iframe, noscript, nav, header, footer, .header, .footer, .nav, .sidebar, .ad, .advertisement, #header, #footer, #nav, #sidebar').remove();
    
    // 获取页面主要内容
    // 尝试找到主要内容区域
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
    
    // 如果没有找到主要内容区域，则尝试查找所有段落
    if (!content || content.length < 100) {
      console.error('未找到主要内容区域，尝试提取所有段落');
      const paragraphs: string[] = [];
      $('p').each((_, element) => {
        const text = $(element).text().trim();
        if (text.length > 20) { // 只保留有意义的段落
          paragraphs.push(text);
        }
      });
      
      if (paragraphs.length > 0) {
        content = paragraphs.join('\n\n');
        console.error(`从段落中提取到内容，长度: ${content.length} 字符`);
      }
    }
    
    // 如果仍然没有找到内容，则获取 body 内容
    if (!content || content.length < 100) {
      console.error('从段落中未找到足够内容，获取body内容');
      content = $('body').text().trim();
    }
    
    // 清理文本
    content = content
      .replace(/\s+/g, ' ')
      .replace(/\n+/g, '\n')
      .trim();
    
    // 添加标题
    const title = $('title').text().trim();
    if (title) {
      content = `标题: ${title}\n\n${content}`;
    }
    
    // 如果内容过长，则截取一部分
    const maxLength = 8000;
    if (content.length > maxLength) {
      content = content.substring(0, maxLength) + '... (内容已截断)';
    }
    
    console.error(`最终提取内容长度: ${content.length} 字符`);
    return content;
  } catch (error) {
    console.error('Error fetching webpage content:', error);
    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      const statusText = error.response?.statusText;
      const contentType = error.response?.headers['content-type'] || 'unknown';
      
      console.error(`HTTP error status: ${status}`);
      console.error(`HTTP error status text: ${statusText}`);
      console.error(`Error response content type: ${contentType}`);
      
      if (status === 403) {
        throw new Error(`获取网页内容失败: 网站拒绝了访问请求 (403 Forbidden). 这可能是因为反爬虫机制。请稍后重试或尝试其他链接。`);
      } else if (status === 404) {
        throw new Error(`获取网页内容失败: 页面不存在 (404 Not Found)`);
      } else if (status === 429) {
        throw new Error(`获取网页内容失败: 请求过于频繁 (429 Too Many Requests). 请稍后重试。`);
      } else if (status) {
        throw new Error(`获取网页内容失败: HTTP ${status} ${statusText || ''}`);
      }
    }
    throw new Error(`获取网页内容失败: ${error instanceof Error ? error.message : '未知错误'}`);
  }
}

// Create MCP server instance
const server = new McpServer({
  name: "bing-search",
  version: "2.0.0"
});

// 注册必应搜索工具
server.tool(
  "bing_search",
  "使用必应搜索指定的关键词，并返回搜索结果列表，包括标题、链接、摘要和ID",
  {
    query: z.string().describe("搜索关键词"),
    num_results: z.number().default(5).describe("返回的结果数量，默认为5")
  },
  async ({ query, num_results }) => {
    try {
      // 调用必应搜索
      const results = await searchBing(query, num_results);
      
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

// 注册网页内容抓取工具
server.tool(
  "fetch_webpage",
  "根据提供的ID获取对应网页的内容",
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

// 运行服务器
async function main() {
  try {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("必应搜索 MCP 服务器已启动");
  } catch (error) {
    console.error("服务器启动失败:", error);
    process.exit(1);
  }
}

main();