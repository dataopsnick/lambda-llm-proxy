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

// Updated formatChunk to properly handle Gemini responses
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
      
      // Convert to OpenAI format
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
  
  // Fallback for unknown format
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
    const params = JSON.parse(body) as OpenAI.Chat.Completions.ChatCompletionCreateParams;

    const server = this.prefix(event.rawPath)
    let llmClient;

    try {
      llmClient = this.getLlmClient(server);
    } catch (error) {
      this.addErrorResponse(400, writable);
      return;
    }

    const content = params.messages && params.messages.length > 0 ? params.messages[params.messages.length -1].content : "";
    if (typeof content !== 'string') {
        this.addErrorResponse(400, writable, "Invalid message content");
        return;
    }

    if (params.stream) {
      let chunkStream;

      try {
        chunkStream = await llmClient.chatCompletionStreaming(content as string);
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

      // Handle different stream types
      if (llmClient.gemini) {
        // Gemini stream - need to extract text from complex objects
        console.log('Processing Gemini stream');
        try {
          for await (const chunk of chunkStream) {
            console.log('Raw Gemini chunk:', JSON.stringify(chunk, null, 2));
            
            // The chunk from Gemini has a text() method
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
              // Direct Gemini response object
              const formattedChunk = formatChunk(chunk);
              writable.write(formattedChunk);
            }
          }
        } catch (streamError) {
          console.error('Error processing Gemini stream:', streamError);
        }
      } else {
        // OpenAI stream - process normally
        console.log('Processing OpenAI stream');
        const iterator = chunkStream[Symbol.asyncIterator]();
        for await (const chunk of transformGenerator(iterator, formatChunk)) {
          writable.write(chunk);
        }
      }
      
      writable.write(chunkString('[DONE]'));
      writable.end();

    } else {
      // Non-streaming
      const response = await llmClient.chatCompletionNonStreaming(content as string);
      
      // Convert Gemini non-streaming response to OpenAI format if needed
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
      writable.end();
    }
  };

  prefix(rawPath: String): string {
    return rawPath.split('/')[1];
  }

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