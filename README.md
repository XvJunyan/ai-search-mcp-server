# ai-search-mcp-server

AI搜索的MCP server，支持使用日语/英语/中文进行搜索，日语效果最佳。

## 配置方法

在Claude desktop中添加以下配置:

```json
"AISearch": {
    "command": "npx",
    "args": ["github:XvJunyan/ai-search-mcp-server"],
    "env": {
        "SEARCH_API_URL": "ws:xxxxxxxxx/xxxxxxxxx",
        "SEARCH_API_KEY": "xxxxxx"
    }
}

如有使用需要可以联系 junyan_xv@foxmail.com 申请API_key
