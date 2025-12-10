import * as cheerio from "cheerio";

// Define search result types
export interface SearchResult {
  id: string;
  title: string;
  link: string;
  snippet: string;
}

export interface SearchResultWithTimestamp extends SearchResult {
  timestamp: number; // When the result was created
}

// Callback types for dependencies
export type GenerateIdCallback = (prefix?: string) => string;
export type SaveResultCallback = (result: SearchResultWithTimestamp) => void;
export type CleanupCallback = () => void;

/**
 * Extract Bing search results from HTML content (pure extraction, no fallback)
 * @param {string} htmlContent - HTML content from Bing search page
 * @param {number} numResults - Maximum number of results to return
 * @param {GenerateIdCallback} generateId - Function to generate unique IDs
 * @param {SaveResultCallback} saveResult - Function to save results to storage
 * @param {CleanupCallback} cleanup - Function to cleanup old results
 * @returns {Array<SearchResult>} Array of extracted search results
 */
export function extractBingSearchResults(
  htmlContent: string,
  numResults: number,
  generateId: GenerateIdCallback,
  saveResult: SaveResultCallback,
  cleanup: CleanupCallback
): SearchResult[] {
  // Use Cheerio to parse HTML
  const $ = cheerio.load(htmlContent);
  
  // Find search result list
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
      
      // Generate unique ID
      const id = generateId('result');
      
      // Debug output
      console.error(`Found result ${index}: title="${title.substring(0, 50)}", link="${link.substring(0, 50)}..."`);
      
      // Check for duplicates by link
      const isDuplicate = results.some(r => r.link === link && link);
      if (isDuplicate) {
        console.error(`Skipping duplicate result with link: ${link.substring(0, 50)}`);
        return;
      }
      
      // Save to result map with timestamp
      const result: SearchResultWithTimestamp = { 
        id, 
        title, 
        link, 
        snippet,
        timestamp: Date.now()
      };
      saveResult(result);
      
      // Clean up old results periodically
      if (results.length % 50 === 0) {
        cleanup();
      }
      
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
      
      const id = generateId('result_link');
      console.error(`Extracted potential result link: ${title.substring(0, 50)} - ${fullLink.substring(0, 50)}`);
      
      const result: SearchResultWithTimestamp = { 
        id, 
        title: title.substring(0, 200), 
        link: fullLink, 
        snippet: snippet.substring(0, 300),
        timestamp: Date.now()
      };
      saveResult(result);
      results.push(result);
    });
  }
  
  console.error(`Final: returning ${results.length} results`);
  return results;
}

