# Call Tree - Core Methods

## Overview
This document describes the call tree for the two core methods in the Bing CN MCP server.

---

## 1. searchBing() - 必应搜索方法

### Call Flow
```
MCP Client Request
    ↓
server.tool("bing_search", ...) [line 584]
    ↓
async ({ query, num_results }) => { ... } [line 591]
    ↓
await searchBing(query, num_results) [line 594]
    ↓
┌─────────────────────────────────────────────────────────┐
│ searchBing(query: string, numResults: number) [line 33] │
└─────────────────────────────────────────────────────────┘
    │
    ├─→ Build search URL [line 36]
    │   └─→ encodeURIComponent(query)
    │
    ├─→ Set request headers [line 40-52]
    │   └─→ USER_AGENT, Accept, Accept-Language, etc.
    │
    ├─→ axios.get(searchUrl, { headers, timeout }) [line 55]
    │   └─→ HTTP GET request to Bing CN
    │
    ├─→ cheerio.load(response.data) [line 67]
    │   └─→ Parse HTML response
    │
    ├─→ Extract results using multiple selectors [line 83-303]
    │   ├─→ Try '#b_results > li.b_algo'
    │   ├─→ Try '#b_results > li.b_ans'
    │   ├─→ Try '#b_results > li:not(.b_ad)...'
    │   ├─→ Try '#b_topw > li.b_algo'
    │   └─→ Try '#b_topw > li.b_ans'
    │
    ├─→ For each result element [line 93]
    │   ├─→ Extract title [line 108-178]
    │   │   ├─→ Method 1: h2 a
    │   │   ├─→ Method 2: .b_tpcn .tptt
    │   │   ├─→ Method 3: .b_title a, a.tilk
    │   │   └─→ Method 4: h2 text
    │   │
    │   ├─→ Extract link [line 109-178]
    │   │   ├─→ From h2 a href
    │   │   ├─→ From .tilk href/redirecturl/data-h
    │   │   └─→ Fix relative URLs [line 195-210]
    │   │
    │   ├─→ Extract snippet [line 180-200]
    │   │   ├─→ From .b_caption p
    │   │   ├─→ From .b_snippet, .b_lineclamp2
    │   │   └─→ From element text
    │   │
    │   └─→ Save to searchResults Map [line 290]
    │       └─→ searchResults.set(id, result)
    │
    ├─→ Fallback: Extract from links [line 305-371]
    │   └─→ If no results found with selectors
    │
    └─→ Return results array [line 375]
        └─→ Return SearchResult[]
    │
    ↓
Return JSON stringified results [line 600]
    ↓
MCP Response to Client
```

### Key Dependencies
- **axios**: HTTP client for fetching Bing search page
- **cheerio**: HTML parsing and DOM manipulation
- **searchResults Map**: Global storage for results (used by fetchWebpageContent)

---

## 2. fetchWebpageContent() - 网页内容获取方法

### Call Flow
```
MCP Client Request
    ↓
server.tool("fetch_webpage", ...) [line 619]
    ↓
async ({ result_id }) => { ... } [line 625]
    ↓
await fetchWebpageContent(result_id) [line 628]
    ↓
┌──────────────────────────────────────────────────────────┐
│ fetchWebpageContent(resultId: string) [line 402]        │
└──────────────────────────────────────────────────────────┘
    │
    ├─→ Get result from searchResults Map [line 405]
    │   └─→ searchResults.get(resultId)
    │   └─→ Extract URL: result.link
    │
    ├─→ Set request headers [line 414-428]
    │   ├─→ User-Agent, Accept, Accept-Language
    │   ├─→ Accept-Encoding: gzip, deflate, br
    │   ├─→ Sec-Fetch-* headers
    │   └─→ Dynamic Referer based on target URL [line 431-436]
    │
    ├─→ Random delay (200-700ms) [line 440-441]
    │   └─→ Avoid bot detection
    │
    ├─→ axios.get(url, { headers, timeout, ... }) [line 443]
    │   ├─→ responseType: 'arraybuffer'
    │   ├─→ maxRedirects: 5
    │   └─→ validateStatus: (status) => status < 500
    │
    ├─→ Handle HTTP errors [line 453-460]
    │   ├─→ 403 Forbidden → throw error
    │   └─→ Other 4xx → throw error
    │
    ├─→ Detect encoding [line 462-472]
    │   ├─→ From Content-Type header
    │   └─→ Fallback to UTF-8
    │
    ├─→ Decode HTML content [line 474-481]
    │   ├─→ TextDecoder(encoding)
    │   └─→ Fallback to UTF-8 if fails
    │
    ├─→ cheerio.load(html) [line 484]
    │   └─→ Parse HTML
    │
    ├─→ Remove unwanted elements [line 487]
    │   └─→ script, style, iframe, nav, header, footer, ads, etc.
    │
    ├─→ Extract main content [line 489-523]
    │   ├─→ Try main selectors [line 492-500]
    │   │   ├─→ main, article, .content, #content, etc.
    │   │   └─→ Extract text from matched elements
    │   │
    │   ├─→ Try paragraph extraction [line 502-508]
    │   │   └─→ $('p').each() → collect paragraphs
    │   │
    │   └─→ Fallback to body text [line 512-515]
    │       └─→ $('body').text()
    │
    ├─→ Clean content [line 518-521]
    │   ├─→ Replace multiple spaces
    │   └─→ Replace multiple newlines
    │
    ├─→ Add page title [line 524-527]
    │   └─→ $('title').text()
    │
    └─→ Truncate if too long [line 530-533]
        └─→ Max 8000 characters
    │
    ↓
Return content string [line 534]
    ↓
MCP Response to Client
```

### Key Dependencies
- **searchResults Map**: Get URL from previous search result
- **axios**: HTTP client for fetching webpage
- **cheerio**: HTML parsing and content extraction
- **TextDecoder**: Handle various character encodings

---

## Data Flow

### searchBing → fetchWebpageContent
```
1. searchBing() executes
   └─→ Stores results in searchResults Map
       └─→ Each result has: { id, title, link, snippet }

2. Client receives search results with IDs
   └─→ Example: { id: "result_123", title: "...", link: "https://..." }

3. Client calls fetch_webpage with result_id
   └─→ fetchWebpageContent("result_123")

4. fetchWebpageContent() retrieves URL from Map
   └─→ const result = searchResults.get("result_123")
   └─→ const url = result.link

5. Fetches and returns webpage content
```

---

## Error Handling

### searchBing()
- **Network errors**: Caught at line 376, returns error result
- **Parsing errors**: Logged, returns partial results or error result
- **No results**: Returns fallback result with search URL

### fetchWebpageContent()
- **Invalid resultId**: Throws error at line 407
- **403 Forbidden**: Thrown at line 455 with specific message
- **Other HTTP errors**: Thrown at line 459
- **Decoding errors**: Fallback to UTF-8 at line 479
- **All errors**: Re-thrown at line 558 with formatted message

---

## Global State

### searchResults Map (line 25)
- **Type**: `Map<string, SearchResult>`
- **Purpose**: Store search results for later retrieval by ID
- **Lifecycle**: 
  - Populated by `searchBing()`
  - Read by `fetchWebpageContent()`
  - Persists for the lifetime of the server process

---

## Summary

1. **searchBing()**: 
   - Fetches Bing search page
   - Parses HTML with Cheerio
   - Extracts results using multiple selector strategies
   - Stores results in global Map
   - Returns result array

2. **fetchWebpageContent()**:
   - Retrieves URL from global Map using result ID
   - Fetches webpage with browser-like headers
   - Parses and extracts main content
   - Cleans and truncates content
   - Returns content string

Both methods are exposed as MCP tools and can be called independently by MCP clients.
