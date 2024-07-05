import { APIGatewayProxyEventV2, Context } from "aws-lambda";
import OpenAI from 'openai';
import { APIError } from "openai/error";
import { Writable } from "stream";
import { LlmClient } from './llm_client';
import { OpenAiServerSettings } from "./openai_settings";

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

const formatChunk = (chunk: OpenAI.Chat.Completions.ChatCompletionChunk): string => {
  const chunkBody = JSON.stringify(chunk);
  return chunkString(chunkBody);
}

export class LlmProxy {
  openAiServerSettings: OpenAiServerSettings;
  llmClients: Map<string, LlmClient> = new Map();

  constructor(openAiServerSettings: OpenAiServerSettings) {
    this.openAiServerSettings = openAiServerSettings;
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

    if (params.stream) {
      let chunkStream;

      try {
        chunkStream = await llmClient.createCompletionStreaming(params);
      } catch (error) {
        this.handleApiError(error, writable);
        return;
      }

      // overwrite default Content-Type header, application/octet-stream, to text/event-stream to generate an Event Stream
      const metadata = {
        statusCode: 200,
        headers: {
          "Content-Type": "text/event-stream",
        },
      };

      // @ts-expect-error
      writable = awslambda.HttpResponseStream.from(writable, metadata);

      const iterator = chunkStream[Symbol.asyncIterator]();
      for await (const chunk of transformGenerator(iterator, formatChunk)) {
        writable.write(chunk);
      }
      writable.write(chunkString('[DONE]'));
      writable.end();

    } else {
      const response = await llmClient.createCompletionNonStreaming(params);
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

    if (!(server in this.openAiServerSettings)) {
      throw new Error(`No settings for server ${server}`);
    }

    const settings = this.openAiServerSettings[server];
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

  addErrorResponse(statusCode: number, writable: Writable) {
    const metadata = {
      statusCode: statusCode,
    };

    // @ts-expect-error
    writable = awslambda.HttpResponseStream.from(writable, metadata);
    writable.write('Invalid request');

    writable.end();
  }
}