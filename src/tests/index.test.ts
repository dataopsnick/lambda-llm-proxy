import { describe, expect, test } from '@jest/globals';
import { APIGatewayProxyEventV2 } from 'aws-lambda';
import fs from 'fs';
import zlib from 'zlib';
import OpenAI from 'openai';
import { Writable } from 'stream';
import { getOpenAiServerSettings } from '../app_settings';
import { LlmClient } from '../llm_client';
import { LlmProxy } from '../llm_proxy';

describe('app', () => {
  const server = 'replicate'
  const openAiServerSettings = getOpenAiServerSettings();
  const llmProxy = new LlmProxy(openAiServerSettings);

  const openaiSettings = openAiServerSettings['proxy'];
  const llmClient = new LlmClient(openaiSettings!);

  const apiGatewayRequestSampleFile = './src/tests/api_gateway_request.json';
  const prompt = "What is the capital of Paris?";

  describe('Unit', () => {
    const context = {
      callbackWaitsForEmptyEventLoop: false,
      functionName: 'openaiProxy',
      functionVersion: '$LATEST',
      invokedFunctionArn: 'arn:aws:lambda:us-west-2:0123456789:function:openaiProxy',
      memoryLimitInMB: '128',
      awsRequestId: 'fc675b71-f956-455a-9390-fcf9fa87732a',
      logGroupName: '/aws/lambda/openaiProxy',
      logStreamName: '2024/06/25/[$LATEST]b14ac80bbc314bc9a84e810537df192b',
      getRemainingTimeInMillis: () => {
        return 60000 // 60 seconds
      },
      done: (error?: Error, result?: any) => {
        console.log('done', error, result);
      },
      fail: (error: Error | string) => {
        console.log('fail', error);
      },
      succeed: (messageOrObject: any) => {
        console.log('succeed', messageOrObject);
      }
    }
    const createApiGatewayRequest = (params: OpenAI.Chat.Completions.ChatCompletionCreateParams): APIGatewayProxyEventV2 => {
      const rawData = fs.readFileSync(apiGatewayRequestSampleFile);
      const rawObject = JSON.parse(rawData.toString());
      const apiGatewayProxyEventV2 = rawObject as APIGatewayProxyEventV2;

      apiGatewayProxyEventV2['body'] = JSON.stringify(params);
      apiGatewayProxyEventV2['rawPath'] = `/${server}/v1/chat/completions`

      return apiGatewayProxyEventV2;
    };

    const readCompressed = (fileName: string): string => {
      const data = fs.readFileSync(fileName);
      //const buffer = Buffer.from(data);
      return zlib.gunzipSync(data).toString();
    };

    test('Streaming', async () => {
      const params = llmClient.completionParamsStreaming(prompt);

      const apiGatewayProxyEventV2 = createApiGatewayRequest(params);

      const chunks: Array<string> = []
      const responseStream = new Writable({
        write(chunk, _, callback) {
          chunks.push(chunk.toString());
          callback();
        }
      });

      await llmProxy.streamingHandler(apiGatewayProxyEventV2, responseStream, context);

      console.log(chunks);

      expect(chunks.length).toBeGreaterThan(1);
    });

    test('Non Streaming', async () => {
      const params = llmClient.completionParamsNonStreaming(prompt);

      const apiGatewayProxyEventV2 = createApiGatewayRequest(params);

      const chunks: Array<string> = []

      const responseStream = new Writable({
        write(chunk, encoding, callback) {
          chunks.push(chunk.toString());
          callback();
        }
      });

      await llmProxy.streamingHandler(apiGatewayProxyEventV2, responseStream, context)

      console.log(chunks);
      expect(chunks.length).toEqual(1);
      const chunk = chunks[0];
      expect(JSON.parse(chunk).choices[0].message.content).toMatch("France");
    });

    test.skip('Above 32k context size', async () => {
      const promptFile = './src/tests/above_32k.txt.gz';
      const largePrompt = readCompressed(promptFile);
      expect(largePrompt.length).toBeGreaterThan(32768);

      const params = llmClient.completionParamsStreaming(largePrompt);
      const apiGatewayProxyEventV2 = createApiGatewayRequest(params);

      let response;
      const responseStream = new Writable({
        write(chunk, _, callback) {
          response = chunk.toString();
          callback();
        }
      });
      await llmProxy.streamingHandler(apiGatewayProxyEventV2, responseStream, context);
      expect(response).toMatch('Invalid request');
    });

  });

  describe('Integration', () => {
    test('Streaming', async () => {
      const chunkStream = await llmClient.chatCompletionStreaming(prompt);
      let response = '';
      for await (const chunk of chunkStream) {
        response += chunk.choices[0].delta.content;
      }
      expect(response).toMatch("France");
    });

    test('Non streaming', async () => {
      const chunk = await llmClient.chatCompletionNonStreaming(prompt);
      const response = chunk.choices[0].message.content;
      expect(response).toMatch("France");
    });
  });
});