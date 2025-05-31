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
    // Check what the shape of 'next.value' is, and adapt the transform function accordingly
    if (typeof next.value === 'string') { // Assuming Gemini stream chunks are strings
        yield transform(next.value as F); // Or handle specific Gemini chunk structure
    } else { // Assuming OpenAI chunk structure
        yield transform(next.value);
    }
  }
}

const chunkString = (chunkBody: string): string => {
  console.log('chunk', chunkBody);
  return `data: ${chunkBody}\n\n`;
}

const formatChunk = (chunk: OpenAI.Chat.Completions.ChatCompletionChunk | string): string => {
  if (typeof chunk === 'string') {
    // For Gemini, assuming the chunk is already the text or needs minimal processing
    // This might need adjustment based on actual Gemini chunk structure
    return chunkString(JSON.stringify({ choices: [{ delta: { content: chunk } }] }));
  }
  // For OpenAI
  const chunkBody = JSON.stringify(chunk);
  return chunkString(chunkBody);
}

export class LlmProxy {
  serverSettings: OpenAiServerSettings | Record<string, GeminiSettings>; // Updated to handle both
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
    const params = JSON.parse(body) as OpenAI.Chat.Completions.ChatCompletionCreateParams; // This might need to be more generic or checked

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
        // Use the unified chatCompletionStreaming method
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

      const iterator = chunkStream[Symbol.asyncIterator]();
      for await (const chunk of transformGenerator(iterator, formatChunk)) {
        writable.write(chunk);
      }
      writable.write(chunkString('[DONE]'));
      writable.end();

    } else {
      // Non-streaming - this part might need adjustment if Gemini non-streaming is different
      const response = await llmClient.chatCompletionNonStreaming(content as string);
      writable.write(JSON.stringify(response));
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

    const settings = this.serverSettings[server] as OpenAiSettings | GeminiSettings; // Type assertion
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
