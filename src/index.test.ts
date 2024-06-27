import { describe, test, expect } from '@jest/globals';
import OpenAI from 'openai';
import { Writable } from 'stream';
import { LlmClient } from './llm_client';
import { LlmProxy } from './llm_proxy';
import { APIGatewayProxyEventV2 } from 'aws-lambda';
import { getAppSettings } from './app_settings';


describe('app', () => {
  const prompt = "What is the capital of Paris?";
  const appSettings = getAppSettings();
  const model = '';
  const llmClient = new LlmClient(appSettings.lambdaProxy, model);
  const llmProxy = new LlmProxy(appSettings.openaiServer);

  describe('Unit', () => {
    const settings = {
      baseUrl: '',
      apiKey: '',
    };

    const apiGatewayRequestContextV2 = {
      accountId: 'acountId',
      apiId: 'apiId',
      domainName: 'example.com',
      domainPrefix: 'prefix',
      http: {
        method: 'GET',
        path: '/path',
        protocol: 'HTTP/1.1',
        sourceIp: '123.123.123.123',
        userAgent: 'userAgent'
      },
      requestId: 'requestId',
      stage: '$default',
      routeKey: '$default',
      time: '12/Mar/2020:19:03:58 +0000',
      timeEpoch: 1583348638390,
    }
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
    const createApiGatewayRequest = (params: OpenAI.Chat.Completions.ChatCompletionCreateParams) : APIGatewayProxyEventV2 => {
      return {
        version: '2.0',
        routeKey: '$default',
        rawPath: '/path',
        rawQueryString: '',
        headers: {
        },
        requestContext: apiGatewayRequestContextV2,
        isBase64Encoded: false,
        body: JSON.stringify(params)
      };
    };

    test('Streaming', async () => {
      const params = llmClient.completionParamsStreaming(prompt);

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

      expect(chunks.length).toBeGreaterThan(1);

      const chunk = chunks[chunks.length-1];
      expect(chunk).toMatch("DONE");
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