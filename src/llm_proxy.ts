import { APIGatewayProxyEventV2, Context } from "aws-lambda";
import OpenAI from 'openai';
import { Writable } from 'stream';
import { LlmClient } from './llm_client';
import { OpenAiSettings } from "./openai_settings";

export class LlmProxy {
  llmClient: LlmClient;

  constructor(settings: OpenAiSettings) {
    this.llmClient = new LlmClient(settings, '');
  }

  streamingHandler = async (
    event: APIGatewayProxyEventV2,
    responseStream: Writable,
    _: Context
  ) => {
    const body = event.body!;
    console.log('request', body);
    const params = JSON.parse(body) as OpenAI.Chat.Completions.ChatCompletionCreateParams;

    if (params.stream) {
      let chunkStream;

      try {
        chunkStream = await this.llmClient.createCompletionStreaming(params);
      } catch (error) {
        console.error(error);

        // change HTTP status to a bad server response
        const metadata = {
          statusCode: 500,
        };

        // @ts-expect-error
        responseStream = awslambda.HttpResponseStream.from(responseStream, metadata);

        this.writeBody(responseStream, "Something went wrong");
        responseStream.end();
        return;
      }

      for await (const chunk of chunkStream) {
        const chunkStr = JSON.stringify(chunk);
        this.writeChunk(responseStream, chunkStr);
      }
      this.writeChunk(responseStream, "[DONE]");
    } else {
      const response = await this.llmClient.createCompletionNonStreaming(params);
      this.writeBody(responseStream, JSON.stringify(response));
    }

    responseStream.end();
  };

  writeChunk(writable: Writable, chunkStr: string) {
    writable.write(`data: ${chunkStr}\n\n`);
    console.log('data', chunkStr);
  }

  writeBody(writable: Writable, body: string) {
    writable.write(body);
    console.log('response', body);
  }
}