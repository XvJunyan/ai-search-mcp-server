#!/usr/bin/env node

const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const { z } = require('zod');
const os = require('os');

// 解析命令行参数
const args = process.argv.slice(2);
// 默认保存目录从环境变量获取，如果未设置则使用临时目录
let saveDir = process.env.SEARCH_SAVE_DIR || null;

// 从环境变量获取API配置
const API_URL = process.env.SEARCH_API_URL;
const API_KEY = process.env.SEARCH_API_KEY;

// 保留命令行参数来覆盖环境变量（优先级高于环境变量）
for (let i = 0; i < args.length; i++) {
    if (args[i] === '--save-dir' && i + 1 < args.length) {
        saveDir = args[i + 1];
        i++;
    }
}

// 确保保存目录存在
if (!saveDir) {
    saveDir = path.join(os.tmpdir(), 'search-results');
}

if (!fs.existsSync(saveDir)) {
    try {
        fs.mkdirSync(saveDir, { recursive: true });
        console.error(`[Search MCP] 创建结果保存目录: ${saveDir}`);
    } catch (err) {
        console.error(`[Search MCP] 创建结果保存目录失败: ${err.message}`);
        console.error(`[Search MCP] 将使用临时目录: ${os.tmpdir()}`);
        saveDir = os.tmpdir();
    }
}

console.error(`[Search MCP] 使用WebSocket连接: ${API_URL}`);
console.error(`[Search MCP] 结果将保存到: ${saveDir}`);

// 保存搜索结果到文件
async function saveResultsFile(data, format = 'json') {
    try {
        // 创建文件名
        const timestamp = Date.now();
        const fileName = `search-${timestamp}.${format}`;
        const filePath = path.join(saveDir, fileName);
        
        // 保存文件
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
        console.error(`[Search MCP] 结果已保存: ${filePath}`);
        
        return filePath;
    } catch (error) {
        console.error(`[Search MCP] 保存结果失败: ${error.message}`);
        throw error;
    }
}

// 使用WebSocket发送请求并接收流式响应
function sendWebSocketRequest(url, data, apiKey) {
    return new Promise((resolve, reject) => {
        try {
            const ws = new WebSocket(url, {
                headers: {
                    'Content-Type': 'application/json',
                    'apikey': apiKey
                }
            });
            
            let fullResponse = [];
            let contentParts = [];
            let isFirstMessage = true;
            
            ws.on('open', () => {
                console.error('[Search MCP] WebSocket连接已建立');
                // 发送JSON请求
                ws.send(JSON.stringify(data));
            });
            
            ws.on('message', (message) => {
                try {
                    const rawMessage = message.toString();
                    console.error(`[Search MCP] 收到消息: ${rawMessage.substring(0, 100)}...`);
                    
                    // 尝试解析JSON
                    const messageData = JSON.parse(rawMessage);
                    
                    // 记录消息
                    fullResponse.push(messageData);
                    
                    // 根据errno判断消息类型
                    if (messageData.errno === 0) {
                        // 正常的内容流
                        if (messageData.data && messageData.data.content) {
                            contentParts.push(messageData.data.content);
                        }
                    } else if (messageData.errno === 5) {
                        // 流结束标志
                        console.error('[Search MCP] 收到流结束消息');
                    } else {
                        // 其他错误码
                        console.error(`[Search MCP] 收到错误码: ${messageData.errno}`);
                    }
                } catch (err) {
                    console.error(`[Search MCP] 解析消息失败: ${err.message}, 原始消息: ${message.toString().substring(0, 100)}...`);
                }
            });
            
            ws.on('close', () => {
                console.error('[Search MCP] WebSocket连接已关闭');
                // 合并所有响应内容
                const result = {
                    fullResponses: fullResponse,
                    combinedContent: contentParts.join('')
                };
                resolve(result);
            });
            
            ws.on('error', (err) => {
                console.error(`[Search MCP] WebSocket错误: ${err.message}`);
                reject(err);
            });
            
            // 设置30秒超时
            setTimeout(() => {
                if (ws.readyState === WebSocket.OPEN) {
                    console.error('[Search MCP] WebSocket连接超时，强制关闭');
                    ws.close();
                }
            }, 30000);
        } catch (error) {
            reject(error);
        }
    });
}

// 创建MCP服务器
const server = new McpServer({
    name: "SearchStreaming",
    version: "1.0.0"
});

// 添加问答工具
server.tool(
    "answerQuestion",
    {
        question: z.string().describe("用户的问题"),
        language: z.string().default("zh").describe("回答的语言 (zh 或 ja)")
    },
    async ({ question, language = "zh" }) => {
        try {
            console.error(`[Search MCP] 处理问题: "${question.substring(0, 30)}${question.length > 30 ? '...' : ''}"`);
            
            // 转换语言参数
            let apiLanguage = language;
            if (language === "zh") {
                apiLanguage = "Chinese";
            } else if (language === "ja") {
                apiLanguage = "Japanese";
            } else {
                apiLanguage = "English";
            }
            
            // 构建请求体，基于API文档
            const requestBody = {
                "bee": "6C44A6E0-63D4-1F9E-2EA2-3FCEA2615972",
                "device": "android",
                "app_version": "833",
                "system_version": "30",
                "pkg": "com.google.android.googlequicksearchbox",
                "session_id": "3783f0ca-2d83-4fe2-b1b9-d8f8ee41b2b41331",
                "logid": "456e60e7-8e36-41ac-8a09-1e756013",
                "query": question,
                "search_engine": "Bing",
                "llm_name": "gpt4o",
                "language": apiLanguage
            };
            
            // 使用WebSocket发送请求并接收流式响应
            const response = await sendWebSocketRequest(API_URL, requestBody, API_KEY);
            
            // 保存完整响应
            const resultFilePath = await saveResultsFile(response.fullResponses);
            
            // 提取最终答案
            let finalAnswer = response.combinedContent;
            if (!finalAnswer || finalAnswer.trim() === '') {
                // 如果没有合并内容，检查是否有其他类型的响应
                if (response.fullResponses && response.fullResponses.length > 0) {
                    // 遍历所有响应寻找可用内容
                    for (const resp of response.fullResponses) {
                        if (resp.data && resp.data.content) {
                            finalAnswer = resp.data.content;
                            break;
                        } else if (resp.sug_list) {
                            finalAnswer = `建议问题：\n${resp.sug_list.join('\n')}`;
                            break;
                        } else if (resp.sub_query_list) {
                            finalAnswer = `查询拆解结果：\n${resp.sub_query_list.join('\n')}`;
                            break;
                        } else if (resp.search_card_list) {
                            finalAnswer = `搜索结果：\n${JSON.stringify(resp.search_card_list, null, 2)}`;
                            break;
                        }
                    }
                }
                
                // 如果仍未找到内容，返回摘要信息
                if (!finalAnswer || finalAnswer.trim() === '') {
                    finalAnswer = `未能提取到答案内容。已收到 ${response.fullResponses.length} 条消息，请查看 ${resultFilePath} 获取完整响应细节。`;
                }
            }
            
            return {
                content: [
                    { 
                        type: "text", 
                        text: finalAnswer
                    }
                ],
                result: `查询: "${question}" (结果文件: ${resultFilePath})`
            };
        } catch (error) {
            console.error(`[Search MCP] 错误: ${error.message}`);
            return {
                content: [
                    { type: "text", text: `搜索服务错误: ${error.message}` }
                ],
                isError: true
            };
        }
    }
);

// 添加配置信息工具
server.tool(
    "getConfig",
    {},
    async () => {
        const config = {
            api_url: API_URL,
            save_directory: saveDir,
            supported_llm_models: ["gpt3.5", "gpt4", "gpt4o", "gpt4o-mini"],
            supported_search_engines: ["Bing", "Google", "SearXNG", "Yahoo"],
            supported_languages: ["English", "Chinese", "Japanese"]
        };

        return {
            content: [
                { type: "text", text: JSON.stringify(config, null, 2) }
            ]
        };
    }
);

// 启动服务器
const transport = new StdioServerTransport();
server.connect(transport).then(() => {
    console.error('[Search MCP] 服务器已启动');
    console.error(`[Search MCP] 配置信息:`);
    console.error(`  - API URL: ${API_URL}`);
    console.error(`  - 结果保存目录: ${saveDir}`);
}).catch(err => {
    console.error(`[Search MCP] 服务器启动失败: ${err.message}`);
    process.exit(1);
});