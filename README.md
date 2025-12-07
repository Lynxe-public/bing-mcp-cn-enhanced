# Bing CN MCP

一个基于 MCP (Model Context Protocol) 的中文必应搜索工具，可以直接通过 Claude 或其他支持 MCP 的 AI 来搜索必应并获取网页内容。

## 特点

- 支持中文搜索结果
- 无需 API 密钥，直接爬取必应搜索结果
- 提供网页内容获取功能
- 轻量级，易于安装和使用
- 专为中文用户优化
- 支持 Claude 等 AI 工具调用

## 安装

### 全局安装

```bash
npm install -g bing-cn-mcp
```

### 或者直接通过 npx 运行

```bash
npx bing-cn-mcp
```

## 使用方法

### 启动服务器

```bash
bing-cn-mcp
```

或者使用 npx：

```bash
npx bing-cn-mcp
```

### 在支持 MCP 的环境中使用

在支持 MCP 的环境（如 Cursor）中，配置 MCP 服务器来使用它：

1. 找到 MCP 配置文件（例如 `.cursor/mcp.json`）
2. 添加服务器配置：

```json
{
  "mcpServers": {
    "bingcn": {
      "command": "npx",
      "args": [
        "bing-cn-mcp"
      ]
    }
  }
}
```
Windows用户的配置

```json
{
  "mcpServers": {
    "bingcnmcp": {
        "command": "cmd",
        "args": [
          "/c",
          "npx",
          "bing-cn-mcp"
      ]
    }
  }
}
```

3. 现在你可以在 Claude 中使用 `mcp__bing_search` 和 `mcp__fetch_webpage` 工具了

### 查看日志

MCP 服务器的日志输出到 stderr。如果你想将日志保存到文件以便查看，可以通过修改 MCP 配置来实现：

#### macOS/Linux 用户

**方案 1：将日志保存到文件**

```json
{
  "mcpServers": {
    "bingcn": {
      "command": "sh",
      "args": [
        "-c",
        "npx bing-cn-mcp 2>> ~/.mcp-logs/bing-cn-mcp.log"
      ]
    }
  }
}
```

**方案 2：同时输出到终端和文件（使用 tee）**

```json
{
  "mcpServers": {
    "bingcn": {
      "command": "sh",
      "args": [
        "-c",
        "npx bing-cn-mcp 2>&1 | tee -a ~/.mcp-logs/bing-cn-mcp.log >&2"
      ]
    }
  }
}
```


{
  "mcpServers": {
    "bingcn": {
      "args": [
        "bing-cn-mcp"
      ],
      "command": "npx"
    }
  }
}
**方案 3：按日期创建日志文件**

```json
{
  "mcpServers": {
    "bingcn": {
      "command": "sh",
      "args": [
        "-c",
        "mkdir -p ~/.mcp-logs && npx bing-cn-mcp 2>> ~/.mcp-logs/bing-cn-mcp-$(date +%Y-%m-%d).log"
      ]
    }
  }
}
```

#### Windows 用户

**方案 1：将日志保存到文件**

```json
{
  "mcpServers": {
    "bingcn": {
      "command": "cmd",
      "args": [
        "/c",
        "npx bing-cn-mcp 2>> %USERPROFILE%\\.mcp-logs\\bing-cn-mcp.log"
      ]
    }
  }
}
```

**方案 2：使用 PowerShell（推荐）**

```json
{
  "mcpServers": {
    "bingcn": {
      "command": "powershell",
      "args": [
        "-Command",
        "$logDir = Join-Path $env:USERPROFILE '.mcp-logs'; if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir | Out-Null }; $logFile = Join-Path $logDir 'bing-cn-mcp.log'; npx bing-cn-mcp 2>&1 | Tee-Object -FilePath $logFile -Append"
      ]
    }
  }
}
```

#### 查看日志文件

- **macOS/Linux**: `~/.mcp-logs/bing-cn-mcp.log` 或 `~/.mcp-logs/bing-cn-mcp-YYYY-MM-DD.log`
- **Windows**: `%USERPROFILE%\.mcp-logs\bing-cn-mcp.log`

你可以使用以下命令实时查看日志：

```bash
# macOS/Linux
tail -f ~/.mcp-logs/bing-cn-mcp.log

# Windows (PowerShell)
Get-Content %USERPROFILE%\.mcp-logs\bing-cn-mcp.log -Wait -Tail 50
```

## 支持的工具

### bing_search

搜索必应并获取结果列表。

参数：
- `query`: 搜索关键词
- `num_results`: 返回结果数量（默认为 5）

### fetch_webpage

根据搜索结果 ID 获取对应网页的内容。

参数：
- `result_id`: 从 bing_search 返回的结果 ID

## 自定义配置

你可以通过创建 `.env` 文件来自定义配置，例如：

```
# 用户代理设置
USER_AGENT=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36
```

## 注意事项

- 某些网站可能有反爬虫措施，导致 `fetch_webpage` 无法获取内容
- 本工具仅供学习和研究使用，请勿用于商业目的
- 请遵守必应的使用条款和相关法律法规

## 作者

Lynxe

## 许可证

MIT 
