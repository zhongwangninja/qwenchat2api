/**
 * Qwen API to OpenAI Standard - Single File Deno Deploy/Playground Script
 *
 * @version 2.6
 * @description This script acts as a proxy, converting standard OpenAI API requests
 * into the proprietary format used by `chat.qwen.ai` and transforms the response
 * back into the standard OpenAI format. It incorporates the specific logic
 * found in the original Qwen2API Node.js repository.
 *
 * 🎯 **ZERO CONFIGURATION REQUIRED** - No environment variables needed!
 * 🔒 **OPTIONAL SECURITY** - Add SALT for access control!
 * All authentication information is provided by clients via Authorization header.
 *
 * --- DEPLOYMENT INSTRUCTIONS ---
 *
 * 1. **Deno Deploy / Playground Setup**:
 *    - Create a new project in Deno Deploy.
 *    - Copy and paste this entire script into the editor.
 *    - Deploy immediately - no configuration needed!
 *
 * 2. **Optional Security (Environment Variable)**:
 *    - `SALT`: (Optional) A secret salt value for access control.
 *              If set, clients must include this salt in their requests.
 *              Example: `my_secret_salt_123`
 *
 * 3. **Client Usage**:
 *    
 *    **Without SALT (Open Access):**
 *    ```
 *    Authorization: Bearer qwen_token;ssxmod_itna_value
 *    ```
 *    
 *    **With SALT (Restricted Access):**
 *    ```
 *    Authorization: Bearer salt_value;qwen_token;ssxmod_itna_value
 *    ```
 *    
 *    **Examples:**
 *    ```bash
 *    # Open access mode
 *    Authorization: Bearer ey...abc;mqUxRDBD...DYAEDBYD74G+DDeDixGm...
 *    
 *    # Restricted access mode (if SALT=my_secret)
 *    Authorization: Bearer my_secret;ey...abc;mqUxRDBD...DYAEDBYD74G+DDeDixGm...
 *    ```
 *
 * 4. **Run**:
 *    The script will be deployed and run automatically. Your endpoint URL will be provided by Deno Deploy.
 *
 * --- LOCAL USAGE ---
 *
 * 1. Save this file as `main.ts`.
 * 2. Optionally set environment variable for security:
 *    ```bash
 *    export SALT="your_secret_salt"  # Optional for access control
 *    ```
 * 3. Run the script:
 *    ```bash
 *    deno run --allow-net --allow-env main.ts
 *    ```
 * 4. Use with curl:
 *    ```bash
 *    # Without SALT
 *    curl -X POST http://localhost:8000/v1/chat/completions \
 *      -H "Authorization: Bearer your_qwen_token;your_ssxmod_itna" \
 *      -H "Content-Type: application/json" \
 *      -d '{"model":"qwen3-max","messages":[{"role":"user","content":"Hello"}]}'
 *    
 *    # With SALT
 *    curl -X POST http://localhost:8000/v1/chat/completions \
 *      -H "Authorization: Bearer your_salt;your_qwen_token;your_ssxmod_itna" \
 *      -H "Content-Type: application/json" \
 *      -d '{"model":"qwen3-max","messages":[{"role":"user","content":"Hello"}]}'
 *    ```
 *
 * --- ABOUT DENO ---
 * Deno is a modern and secure runtime for JavaScript and TypeScript.
 * - It has built-in support for TypeScript without a separate compilation step.
 * - It uses explicit permissions for file, network, and environment access.
 * - It has a standard library and a decentralized package management system using URLs.
 * This script is designed to be easily deployable on Deno's serverless platform, Deno Deploy.
 */

import { Application, Router, Context, Middleware } from "https://deno.land/x/oak@v12.6.1/mod.ts";
import { Buffer } from "https://deno.land/std@0.177.0/io/buffer.ts";

// --- 1. Configuration from Environment Variables ---

const config = {
  salt: Deno.env.get("SALT") || "",
};

// --- 2. Core Conversion Logic (from original Node.js project analysis) ---

/**
 * Transforms an OpenAI-formatted request body into the proprietary Qwen format.
 * This function mimics the logic from `processRequestBody` in `chat-middleware.js`.
 * @param openAIRequest The incoming request body.
 * @returns A request body for the `chat.qwen.ai` API.
 */
function transformOpenAIRequestToQwen(openAIRequest: any): any {
  const model = openAIRequest.model || "qwen-max";

  // Determine chat_type from model suffix
  let chat_type = 't2t';
  if (model.includes('-search')) chat_type = 'search';
  if (model.includes('-image')) chat_type = 't2i';
  if (model.includes('-video')) chat_type = 't2v';

  // Clean the model name
  const qwenModel = model.replace(/-search|-thinking|-image|-video/g, '');

  const qwenBody = {
    "model": qwenModel,
    "messages": openAIRequest.messages, // Simplified message parsing for playground
    "stream": true,
    "incremental_output": true,
    "chat_type": chat_type,
    "session_id": crypto.randomUUID(),
    "chat_id": crypto.randomUUID(),
    "feature_config": {
      "output_schema": "phase",
      "thinking_enabled": model.includes('-thinking'),
    }
  };

  return qwenBody;
}

/**
 * Creates a TransformStream to convert the Qwen SSE response stream
 * into an OpenAI-compatible SSE stream.
 * This mimics the logic from `handleStreamResponse` in `chat.js`.
 */
function createQwenToOpenAIStreamTransformer(): TransformStream<Uint8Array, Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = '';
  const messageId = crypto.randomUUID();

  return new TransformStream({
    transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true });

      const lines = buffer.split('\n\n');
      buffer = lines.pop() || ''; // Keep partial line

      for (const line of lines) {
        if (!line.startsWith('data:')) continue;

        try {
          const qwenChunk = JSON.parse(line.substring(5));
          if (!qwenChunk.choices || qwenChunk.choices.length === 0) continue;

          const delta = qwenChunk.choices[0].delta;
          if (!delta) continue;

          let content = delta.content || "";

          // Handle special <think> tags
          if (delta.phase === 'think' && !buffer.includes('<think>')) {
            content = `<think>\n${content}`;
          }
          if (delta.phase === 'answer' && buffer.includes('<think>') && !buffer.includes('</think>')) {
            content = `\n</think>\n${content}`;
          }

          const openAIChunk = {
            id: `chatcmpl-${messageId}`,
            object: "chat.completion.chunk",
            created: Math.floor(Date.now() / 1000),
            model: qwenChunk.model || "qwen",
            choices: [{
              index: 0,
              delta: { content: content },
              finish_reason: qwenChunk.choices[0].finish_reason || null,
            }],
          };
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(openAIChunk)}\n\n`));
        } catch (e) {
          console.error("Error parsing Qwen stream chunk:", e);
        }
      }
    },
    flush(controller) {
      // Send the final DONE message
      controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
    },
  });
}

// --- 3. Oak Application and Routes ---

const app = new Application();
const router = new Router();

// Middleware for logging and error handling
app.use(async (ctx, next) => {
  try {
    await next();
  } catch (err) {
    console.error(`Unhandled error: ${err.message}`);
    ctx.response.status = 500;
    ctx.response.body = { error: "Internal Server Error" };
  }
  console.log(`${ctx.request.method} ${ctx.request.url} - ${ctx.response.status}`);
});

// Middleware for Authentication
const authMiddleware: Middleware = async (ctx, next) => {
  // Skip auth for the root informational page
  if (ctx.request.url.pathname === '/') {
    await next();
    return;
  }

  const authHeader = ctx.request.headers.get("Authorization");
  const clientToken = authHeader?.replace(/^Bearer\s+/, '');

  if (!clientToken) {
    const expectedFormat = config.salt
      ? "Authorization: Bearer salt_value;qwen_token;ssxmod_itna_value"
      : "Authorization: Bearer qwen_token;ssxmod_itna_value";

    ctx.response.status = 401;
    ctx.response.body = {
      error: "Unauthorized. Authorization header required.",
      format: `Use: ${expectedFormat}`,
      salt_required: !!config.salt
    };
    return;
  }

  // Parse the token format based on whether SALT is configured
  const parts = clientToken.split(';');
  let qwenToken: string;
  let ssxmodItna: string;

  if (config.salt) {
    // Format: salt;qwen_token;ssxmod_itna_value
    if (parts.length < 2) {
      ctx.response.status = 401;
      ctx.response.body = {
        error: "Invalid token format. Salt, token and optional cookie required.",
        format: "Use: Authorization: Bearer salt_value;qwen_token;ssxmod_itna_value",
        salt_required: true
      };
      return;
    }

    const providedSalt = parts[0]?.trim();
    if (providedSalt !== config.salt) {
      ctx.response.status = 401;
      ctx.response.body = {
        error: "Invalid salt value.",
        format: "Use: Authorization: Bearer salt_value;qwen_token;ssxmod_itna_value",
        salt_required: true
      };
      return;
    }

    qwenToken = parts[1]?.trim();
    ssxmodItna = parts[2]?.trim() || '';
  } else {
    // Format: qwen_token;ssxmod_itna_value
    qwenToken = parts[0]?.trim();
    ssxmodItna = parts[1]?.trim() || '';
  }

  if (!qwenToken) {
    const expectedFormat = config.salt
      ? "Authorization: Bearer salt_value;qwen_token;ssxmod_itna_value"
      : "Authorization: Bearer qwen_token;ssxmod_itna_value";

    ctx.response.status = 401;
    ctx.response.body = {
      error: "Invalid token format. Qwen token is required.",
      format: `Use: ${expectedFormat}`,
      salt_required: !!config.salt
    };
    return;
  }

  // Store parsed values in context state for use in routes
  ctx.state = ctx.state || {};
  ctx.state.qwenToken = qwenToken;
  ctx.state.ssxmodItna = ssxmodItna;

  await next();
};

/**
 * GET / (Root)
 * Serves a simple informational HTML page.
 */
router.get("/", (ctx: Context) => {
  const saltStatus = config.salt ? "🔒 受限访问模式" : "🎯 开放访问模式";
  const authFormat = config.salt
    ? "Authorization: Bearer salt_value;qwen_token;ssxmod_itna_value"
    : "Authorization: Bearer qwen_token;ssxmod_itna_value";

  const htmlContent = `
        <!DOCTYPE html>
        <html lang="zh-CN">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Qwen API Proxy</title>
            <style>
                * {
                    margin: 0;
                    padding: 0;
                    box-sizing: border-box;
                }
                
                body {
                    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    min-height: 100vh;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    padding: 20px;
                }
                
                .container {
                    background: rgba(255, 255, 255, 0.95);
                    backdrop-filter: blur(10px);
                    border-radius: 20px;
                    padding: 40px;
                    box-shadow: 0 20px 40px rgba(0, 0, 0, 0.1);
                    max-width: 500px;
                    width: 100%;
                    text-align: center;
                }
                
                .status {
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    gap: 8px;
                    margin-bottom: 12px;
                }
                
                .status-dot {
                    width: 8px;
                    height: 8px;
                    background: #10b981;
                    border-radius: 50%;
                    animation: pulse 2s infinite;
                }
                
                @keyframes pulse {
                    0%, 100% { opacity: 1; }
                    50% { opacity: 0.5; }
                }
                
                .status-text {
                    font-size: 18px;
                    font-weight: 600;
                    color: #1f2937;
                }
                
                .subtitle {
                    color: #6b7280;
                    font-size: 14px;
                    margin-bottom: 32px;
                    line-height: 1.5;
                }
                
                .api-section {
                    text-align: left;
                    margin-bottom: 32px;
                }
                
                .section-title {
                    font-size: 16px;
                    font-weight: 600;
                    color: #374151;
                    margin-bottom: 16px;
                }
                
                .api-item {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    padding: 12px 0;
                    border-bottom: 1px solid #f3f4f6;
                }
                
                .api-item:last-child {
                    border-bottom: none;
                }
                
                .api-label {
                    color: #6b7280;
                    font-size: 14px;
                }
                
                .api-endpoint {
                    font-family: "SF Mono", Monaco, "Cascadia Code", "Roboto Mono", Consolas, "Courier New", monospace;
                    font-size: 13px;
                    color: #1f2937;
                    background: #f9fafb;
                    padding: 4px 8px;
                    border-radius: 6px;
                    border: 1px solid #e5e7eb;
                }
                
                .auth-section {
                    background: #f8fafc;
                    border: 1px solid #e2e8f0;
                    border-radius: 12px;
                    padding: 20px;
                    margin-bottom: 24px;
                }
                
                .auth-title {
                    font-size: 14px;
                    font-weight: 600;
                    color: #374151;
                    margin-bottom: 8px;
                }
                
                .auth-status {
                    font-size: 13px;
                    color: #059669;
                    margin-bottom: 12px;
                }
                
                .auth-format {
                    font-family: "SF Mono", Monaco, "Cascadia Code", "Roboto Mono", Consolas, "Courier New", monospace;
                    font-size: 11px;
                    color: #4b5563;
                    background: #ffffff;
                    padding: 8px 12px;
                    border-radius: 6px;
                    border: 1px solid #d1d5db;
                    word-break: break-all;
                    line-height: 1.4;
                }
                
                .footer {
                    color: #9ca3af;
                    font-size: 12px;
                    font-weight: 500;
                }
                
                .version {
                    color: #6366f1;
                }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="status">
                    <div class="status-dot"></div>
                    <div class="status-text">服务运行正常</div>
                </div>
                
                <div class="subtitle">
                    欲买桂花同载酒，终不似，少年游
                </div>
                
                <div class="api-section">
                    <div class="section-title">API 端点</div>
                    <div class="api-item">
                        <span class="api-label">模型列表</span>
                        <code class="api-endpoint">/v1/models</code>
                    </div>
                    <div class="api-item">
                        <span class="api-label">聊天完成</span>
                        <code class="api-endpoint">/v1/chat/completions</code>
                    </div>
                </div>
                
                <div class="auth-section">
                    <div class="auth-title">认证方式</div>
                    <div class="auth-status">${saltStatus}</div>
                    <div class="auth-format">${authFormat}</div>
                </div>
                
                <div class="footer">
                    <span class="version">Qwen API Proxy v2.6</span>
                </div>
            </div>
        </body>
        </html>
    `;
  ctx.response.body = htmlContent;
  ctx.response.headers.set("Content-Type", "text/html; charset=utf-8");
});

/**
 * GET /v1/models
 * Fetches the model list from Qwen and adds special variants.
 */
router.get("/v1/models", async (ctx: Context) => {
  const token = ctx.state?.qwenToken;
  if (!token) {
    ctx.response.status = 503;
    ctx.response.body = { error: "Qwen token not provided in Authorization header." };
    return;
  }

  try {
    const response = await fetch('https://chat.qwen.ai/api/models', {
      headers: { 'Authorization': `Bearer ${token}` },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch models: ${response.statusText}`);
    }

    const originalModels = (await response.json()).data;
    const processedModels: any[] = [];

    for (const model of originalModels) {
      processedModels.push(model);
      // Add special variants based on original project logic
      if (model?.info?.meta?.abilities?.thinking) {
        processedModels.push({ ...model, id: `${model.id}-thinking` });
      }
      if (model?.info?.meta?.chat_type?.includes('search')) {
        processedModels.push({ ...model, id: `${model.id}-search` });
      }
      if (model?.info?.meta?.chat_type?.includes('t2i')) {
        processedModels.push({ ...model, id: `${model.id}-image` });
      }
    }

    ctx.response.body = { object: "list", data: processedModels };
  } catch (err) {
    console.error("Error fetching models:", err.message);
    ctx.response.status = 502;
    ctx.response.body = { error: "Failed to fetch models from upstream API." };
  }
});

/**
 * POST /v1/chat/completions
 * The main chat proxy endpoint.
 */
router.post("/v1/chat/completions", async (ctx: Context) => {
  const token = ctx.state?.qwenToken;
  const ssxmodItna = ctx.state?.ssxmodItna;

  if (!token) {
    ctx.response.status = 503;
    ctx.response.body = { error: "Qwen token not provided in Authorization header." };
    return;
  }

  try {
    const openAIRequest = await ctx.request.body({ type: "json" }).value;
    const qwenRequest = transformOpenAIRequestToQwen(openAIRequest);

    const headers: Record<string, string> = {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    };
    if (ssxmodItna) {
      headers['Cookie'] = `ssxmod_itna=${ssxmodItna}`;
    }

    const upstreamResponse = await fetch("https://chat.qwen.ai/api/chat/completions", {
      method: "POST",
      headers: headers,
      body: JSON.stringify(qwenRequest),
    });

    if (!upstreamResponse.ok || !upstreamResponse.body) {
      const errorBody = await upstreamResponse.text();
      console.error(`Upstream API error: ${upstreamResponse.status}`, errorBody);
      ctx.response.status = upstreamResponse.status;
      ctx.response.body = { error: "Upstream API request failed", details: errorBody };
      return;
    }

    // Transform the response stream and send it to the client
    const transformedStream = upstreamResponse.body.pipeThrough(createQwenToOpenAIStreamTransformer());

    ctx.response.body = transformedStream;
    ctx.response.headers.set("Content-Type", "text/event-stream");
    ctx.response.headers.set("Cache-Control", "no-cache");
    ctx.response.headers.set("Connection", "keep-alive");

  } catch (err) {
    console.error("Error in chat completions proxy:", err.message);
    ctx.response.status = 500;
    ctx.response.body = { error: "Internal Server Error" };
  }
});

// Apply middleware
app.use(authMiddleware);
app.use(router.routes());
app.use(router.allowedMethods());
// --- 4. Start Server ---
console.log("🚀 Starting server...");
if (config.salt) {
  console.log("🔒 SALT PROTECTION ENABLED - Restricted access mode");
  console.log("💡 Clients should provide: Authorization: Bearer salt_value;qwen_token;ssxmod_itna_value");
  console.log(`🔑 Salt value configured: ${config.salt.substring(0, 3)}***`);
} else {
  console.log("🎯 OPEN ACCESS MODE - No salt protection");
  console.log("💡 Clients should provide: Authorization: Bearer qwen_token;ssxmod_itna_value");
  console.log("🔓 To enable access control, set SALT environment variable");
}
console.log("📝 All authentication is handled via client Authorization headers.");
// Use the native Deno.serve for deployment.
// The app.handle method is used as the request handler.
Deno.serve((req) => app.handle(req));
console.log(`✅ Server is ready to accept connections.`);
