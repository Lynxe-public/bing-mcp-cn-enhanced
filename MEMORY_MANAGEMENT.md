# Memory Management Analysis

## Current Issues

### 1. **多次调用支持**
✅ **支持**：MCP stdio 服务器是单进程的，所有请求都会路由到同一个 server 进程。

### 2. **内存泄漏问题**
❌ **存在问题**：
- `searchResults` Map 会无限增长
- 没有清理机制
- 大量查询会导致内存持续增长

### 3. **ID 冲突风险**
⚠️ **潜在问题**：
- 使用 `Date.now()` + index 生成 ID
- 同一毫秒内多次调用可能产生相同 ID
- 可能导致结果被覆盖

## Solutions

### Solution 1: Add Expiration and Cleanup
- Add timestamp to each result
- Periodically clean expired results (e.g., 1 hour old)
- Limit Map size (e.g., max 1000 entries)

### Solution 2: Improve ID Generation
- Use counter + timestamp + random
- Ensure uniqueness across concurrent requests

### Solution 3: Add Size Limit
- When Map reaches limit, remove oldest entries
- Use LRU (Least Recently Used) strategy
