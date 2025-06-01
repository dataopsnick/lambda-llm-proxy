import { APIGatewayProxyEventV2, Context } from "aws-lambda";
import OpenAI from 'openai';
import { APIError } from "openai/error";
import { Writable } from "stream";
import { LlmClient } from './llm_client';
import { OpenAiServerSettings, OpenAiSettings } from "./openai_settings";
import { GeminiSettings } from "./gemini_settings";

export const transformGenerator = async function*<F, T>(iterator: AsyncIterator<F>, transform: (f: F) => T) {
  while (true) {
    const next = await iterator.next();
    if (next.done) { return; }
    yield transform(next.value);
  }
}

const chunkString = (chunkBody: string): string => {
  console.log('chunk', chunkBody);
  return `data: ${chunkBody}\n\n`;
}

const formatChunk = (chunk: OpenAI.Chat.Completions.ChatCompletionChunk | any): string => {
  // Handle OpenAI format (passthrough)
  if (chunk && chunk.choices && Array.isArray(chunk.choices)) {
    const chunkBody = JSON.stringify(chunk);
    return chunkString(chunkBody);
  }
  
  // Handle Gemini format - convert to OpenAI format
  if (chunk && chunk.candidates && Array.isArray(chunk.candidates)) {
    const candidate = chunk.candidates[0];
    if (candidate && candidate.content && candidate.content.parts && candidate.content.parts[0]) {
      const text = candidate.content.parts[0].text || '';
      
      const openaiChunk = {
        id: chunk.responseId || 'chatcmpl-gemini',
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: 'gemini-2.0-flash',
        choices: [{
          index: 0,
          delta: {
            content: text
          },
          finish_reason: candidate.finishReason === 'STOP' ? 'stop' : null
        }]
      };
      
      const chunkBody = JSON.stringify(openaiChunk);
      return chunkString(chunkBody);
    }
  }
  
  // Handle raw text (fallback)
  if (typeof chunk === 'string') {
    const openaiChunk = {
      id: 'chatcmpl-gemini',
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model: 'gemini-2.0-flash',
      choices: [{
        index: 0,
        delta: {
          content: chunk
        },
        finish_reason: null
      }]
    };
    
    const chunkBody = JSON.stringify(openaiChunk);
    return chunkString(chunkBody);
  }
  
  console.warn('Unknown chunk format:', chunk);
  return chunkString(JSON.stringify({ 
    choices: [{ 
      delta: { content: '' },
      finish_reason: null 
    }] 
  }));
}

export class LlmProxy {
  serverSettings: OpenAiServerSettings | Record<string, GeminiSettings>;
  llmClients: Map<string, LlmClient> = new Map();

  constructor(serverSettings: OpenAiServerSettings | Record<string, GeminiSettings>) {
    this.serverSettings = serverSettings;
  }

  streamingHandler = async (
    event: APIGatewayProxyEventV2,
    writable: Writable,
    _: Context
  ) => {
    console.log('request', JSON.stringify(event));
    const body = event.body!;
    console.log('body', body);

    // Parse the request path to determine the action
    const pathParts = event.rawPath.split('/');
    const server = pathParts[1];
    const action = pathParts[2]; // 'v1' for chat, 'conversation' for conversation management

    let llmClient;
    try {
      llmClient = this.getLlmClient(server);
    } catch (error) {
      this.addErrorResponse(400, writable, `Server ${server} not configured`);
      return;
    }

    // Handle conversation management endpoints
    if (action === 'conversation') {
      return this.handleConversationManagement(event, writable, llmClient);
    }

    // Handle regular chat completions
    if (action === 'v1' && pathParts[3] === 'chat' && pathParts[4] === 'completions') {
      return this.handleChatCompletion(event, writable, llmClient);
    }

    this.addErrorResponse(404, writable, 'Endpoint not found');
  };

  private handleConversationManagement = async (
    event: APIGatewayProxyEventV2,
    writable: Writable,
    llmClient: LlmClient
  ) => {
    const pathParts = event.rawPath.split('/');
    const operation = pathParts[3]; // load, clear, status

    const metadata = {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
      },
    };

    writable = awslambda.HttpResponseStream.from(writable, metadata);

    try {
      const body = event.body ? JSON.parse(event.body) : {};

      switch (operation) {
        case 'load':
          // Load conversation from file
          const filePath = body.filePath || './conversations/default.json';
          llmClient.loadConversationHistory(filePath);
          writable.write(JSON.stringify({
            success: true,
            message: `Conversation loaded from ${filePath}`,
            historyLength: llmClient.getHistory().length
          }));
          break;

        case 'clear':
          // Clear conversation history
          llmClient.clearHistory();
          writable.write(JSON.stringify({
            success: true,
            message: 'Conversation history cleared'
          }));
          break;

        case 'status':
          // Get conversation status
          const history = llmClient.getHistory();
          writable.write(JSON.stringify({
            success: true,
            historyLength: history.length,
            lastMessages: history.slice(-3) // Last 3 messages for preview
          }));
          break;

        case 'add':
          // Add message to history
          const { role, content } = body;
          if (!role || !content) {
            throw new Error('Role and content are required');
          }
          llmClient.addToHistory(role, content);
          writable.write(JSON.stringify({
            success: true,
            message: 'Message added to history',
            historyLength: llmClient.getHistory().length
          }));
          break;

        default:
          throw new Error(`Unknown conversation operation: ${operation}`);
      }
    } catch (error) {
      writable.write(JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }));
    }

    writable.end();
  };

  private handleChatCompletion = async (
    event: APIGatewayProxyEventV2,
    writable: Writable,
    llmClient: LlmClient
  ) => {
    const body = JSON.parse(event.body!);
    const params = body as OpenAI.Chat.Completions.ChatCompletionCreateParams;

    // Extract messages - support both single message and full conversation
    let messages: Array<{role: string, content: string}>;
    
    if (params.messages && Array.isArray(params.messages)) {
      // Full conversation provided
      messages = params.messages.filter(msg => 
        typeof msg.content === 'string'
      ).map(msg => ({
        role: msg.role,
        content: msg.content as string
      }));
      console.log(`[CHAT] Processing ${messages.length} messages`);
    } else {
      // Legacy: extract last message only
      const lastMessage = params.messages?.[params.messages.length - 1];
      if (!lastMessage || typeof lastMessage.content !== 'string') {
        this.addErrorResponse(400, writable, "Invalid message content");
        return;
      }
      messages = [{
        role: lastMessage.role,
        content: lastMessage.content
      }];
      console.log(`[CHAT] Processing single message (legacy mode)`);
    }

    if (params.stream) {
      await this.handleStreamingResponse(params, messages, writable, llmClient);
    } else {
      await this.handleNonStreamingResponse(messages, writable, llmClient);
    }
  };

  private handleStreamingResponse = async (
    params: any,
    messages: Array<{role: string, content: string}>,
    writable: Writable,
    llmClient: LlmClient
  ) => {
    let chunkStream;

    try {
      chunkStream = await llmClient.chatCompletionStreaming(messages);
    } catch (error) {
      this.handleApiError(error, writable);
      return;
    }

    const metadata = {
      statusCode: 200,
      headers: {
        "Content-Type": "text/event-stream",
      },
    };

    writable = awslambda.HttpResponseStream.from(writable, metadata);

    try {
      if (llmClient.gemini) {
        // Gemini stream processing
        console.log('Processing Gemini stream');
        for await (const chunk of chunkStream) {
          console.log('Raw Gemini chunk:', JSON.stringify(chunk, null, 2));
          
          if (chunk && typeof chunk.text === 'function') {
            try {
              const text = chunk.text();
              if (text) {
                const formattedChunk = formatChunk(text);
                writable.write(formattedChunk);
              }
            } catch (textError) {
              console.error('Error extracting text from Gemini chunk:', textError);
            }
          } else if (chunk && chunk.candidates) {
            const formattedChunk = formatChunk(chunk);
            writable.write(formattedChunk);
          }
        }
      } else {
        // OpenAI stream processing
        console.log('Processing OpenAI stream');
        const iterator = chunkStream[Symbol.asyncIterator]();
        for await (const chunk of transformGenerator(iterator, formatChunk)) {
          writable.write(chunk);
        }
      }
      
      writable.write(chunkString('[DONE]'));
    } catch (streamError) {
      console.error('Error processing stream:', streamError);
    }
    
    writable.end();
  };

  private handleNonStreamingResponse = async (
    messages: Array<{role: string, content: string}>,
    writable: Writable,
    llmClient: LlmClient
  ) => {
    try {
      const response = await llmClient.chatCompletionNonStreaming(messages);
      
      // Convert Gemini response to OpenAI format if needed
      if (typeof response === 'string' && llmClient.gemini) {
        const openaiResponse = {
          id: 'chatcmpl-gemini',
          object: 'chat.completion',
          created: Math.floor(Date.now() / 1000),
          model: llmClient.model,
          choices: [{
            index: 0,
            message: {
              role: 'assistant',
              content: response
            },
            finish_reason: 'stop'
          }],
          usage: {
            prompt_tokens: 0,
            completion_tokens: 0,
            total_tokens: 0
          }
        };
        writable.write(JSON.stringify(openaiResponse));
      } else {
        writable.write(JSON.stringify(response));
      }
    } catch (error) {
      this.handleApiError(error, writable);
      return;
    }
    
    writable.end();
  };

  getLlmClient(server: string): LlmClient {
    if (this.llmClients.has(server)) {
      return this.llmClients.get(server)!;
    }

    if (!(server in this.serverSettings)) {
      throw new Error(`No settings for server ${server}`);
    }

    const settings = this.serverSettings[server] as OpenAiSettings | GeminiSettings;
    const llmClient = new LlmClient(settings);

    this.llmClients.set(server, llmClient);
    return llmClient;
  }

  handleApiError(error: unknown, writable: Writable) {
    console.log('API error', error);
    let statusCode = 500;
    if (error instanceof APIError && error.status) {
      statusCode = error.status!;
    }

    this.addErrorResponse(statusCode, writable);
  }

  addErrorResponse(statusCode: number, writable: Writable, message: string = 'Invalid request') {
    const metadata = {
      statusCode: statusCode,
    };

    writable = awslambda.HttpResponseStream.from(writable, metadata);
    writable.write(message);
    writable.end();
  }
}