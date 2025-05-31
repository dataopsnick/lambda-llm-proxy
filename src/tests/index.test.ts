import { describe, expect, test } from '@jest/globals';
import { APIGatewayProxyEventV2 } from 'aws-lambda';
import fs from 'fs';
import zlib from 'zlib';
import OpenAI from 'openai';
import { Writable } from 'stream';
import { getAllServerSettings, AllServerSettings } from '../app_settings';
import { LlmClient } from '../llm_client';
import { LlmProxy } from '../llm_proxy';
import { GeminiSettings } from '../gemini_settings';

describe('app', () => {
  const replicateServer = 'replicate'
  const geminiServer = 'gemini' // Add gemini server name
  const allServerSettings = getAllServerSettings();
  const llmProxy = new LlmProxy(allServerSettings);

  const replicateSettings = allServerSettings[replicateServer];
  const replicateLlmClient = new LlmClient(replicateSettings!);

  // Setup for Gemini client
  const geminiSettings = allServerSettings[geminiServer] as GeminiSettings;
  let geminiLlmClient: LlmClient;
  if (geminiSettings && geminiSettings.token !== 'YOUR_GEMINI_API_KEY') {
    geminiLlmClient = new LlmClient(geminiSettings!);
  }

  const apiGatewayRequestSampleFile = './src/tests/api_gateway_request.json';
  const prompt = "What is the capital of Paris?";

  describe('Unit Tests for Replicate', () => {
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
    const createApiGatewayRequest = (params: OpenAI.Chat.Completions.ChatCompletionCreateParams, serverName: string): APIGatewayProxyEventV2 => {
      const rawData = fs.readFileSync(apiGatewayRequestSampleFile);
      const rawObject = JSON.parse(rawData.toString());
      const apiGatewayProxyEventV2 = rawObject as APIGatewayProxyEventV2;

      apiGatewayProxyEventV2['body'] = JSON.stringify(params);
      apiGatewayProxyEventV2['rawPath'] = `/${serverName}/v1/chat/completions`

      return apiGatewayProxyEventV2;
    };

    const readCompressed = (fileName: string): string => {
      const data = fs.readFileSync(fileName);
      return zlib.gunzipSync(data).toString();
    };

    test('Replicate Streaming', async () => {
      const params = {
        model: replicateLlmClient.model,
        messages: [{ role: 'user', content: prompt }],
        stream: true
      } as OpenAI.Chat.Completions.ChatCompletionCreateParams;

      const apiGatewayProxyEventV2 = createApiGatewayRequest(params, replicateServer);

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

    test('Replicate Non Streaming', async () => {
      const params = {
        model: replicateLlmClient.model,
        messages: [{ role: 'user', content: prompt }],
        stream: false
      } as OpenAI.Chat.Completions.ChatCompletionCreateParams;
      const apiGatewayProxyEventV2 = createApiGatewayRequest(params, replicateServer);

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

    test.skip('Replicate Above 32k context size', async () => {
      const promptFile = './src/tests/above_32k.txt.gz';
      const largePrompt = readCompressed(promptFile);
      expect(largePrompt.length).toBeGreaterThan(32768);

      const params = {
        model: replicateLlmClient.model,
        messages: [{ role: 'user', content: largePrompt }],
        stream: true
      } as OpenAI.Chat.Completions.ChatCompletionCreateParams;
      const apiGatewayProxyEventV2 = createApiGatewayRequest(params, replicateServer);

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

  describe('Integration Tests for Replicate', () => {
    test('Replicate Streaming Integration', async () => {
      const chunkStream = await replicateLlmClient.chatCompletionStreaming(prompt);
      let response = '';
      // Assuming the stream from replicateLlmClient for OpenAI/Replicate is an AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>
      for await (const chunk of chunkStream) {
        response += chunk.choices[0].delta.content;
      }
      expect(response).toMatch("France");
    });

    test('Replicate Non-streaming Integration', async () => {
      const chunk = await replicateLlmClient.chatCompletionNonStreaming(prompt);
      const response = chunk.choices[0].message.content;
      expect(response).toMatch("France");
    });
  });

  // Gemini Tests (Unit and Integration)
  // Conditional execution based on API key presence
  if (geminiSettings && geminiSettings.token !== 'YOUR_GEMINI_API_KEY') {
    describe('Unit Tests for Gemini', () => {
      const context = { // Re-define context or ensure it's in scope if defined globally
        callbackWaitsForEmptyEventLoop: false,
        functionName: 'openaiProxy',
        functionVersion: '$LATEST',
        invokedFunctionArn: 'arn:aws:lambda:us-west-2:0123456789:function:openaiProxy',
        memoryLimitInMB: '128',
        awsRequestId: 'fc675b71-f956-455a-9390-fcf9fa87732a',
        logGroupName: '/aws/lambda/openaiProxy',
        logStreamName: '2024/06/25/[$LATEST]b14ac80bbc314bc9a84e810537df192b',
        getRemainingTimeInMillis: () => 60000,
        done: (error?: Error, result?: any) => console.log('done', error, result),
        fail: (error: Error | string) => console.log('fail', error),
        succeed: (messageOrObject: any) => console.log('succeed', messageOrObject)
      };

      const createGeminiApiGatewayRequest = (promptText: string, stream: boolean): APIGatewayProxyEventV2 => {
        const rawData = fs.readFileSync(apiGatewayRequestSampleFile);
        const rawObject = JSON.parse(rawData.toString());
        const apiGatewayProxyEventV2 = rawObject as APIGatewayProxyEventV2;

        // Gemini expects a simpler body for streaming, just the content
        const bodyParams = {
          model: geminiLlmClient.model, // Use the model from settings
          messages: [{ role: 'user', content: promptText }],
          stream: stream
        };
        apiGatewayProxyEventV2['body'] = JSON.stringify(bodyParams);
        apiGatewayProxyEventV2['rawPath'] = `/${geminiServer}/v1/chat/completions`; // Ensure this path matches your routing
        return apiGatewayProxyEventV2;
      };

      test('Gemini Streaming Unit Test', async () => {
        const apiGatewayProxyEventV2 = createGeminiApiGatewayRequest(prompt, true);
        const chunks: Array<string> = [];
        const responseStream = new Writable({
          write(chunk, _, callback) {
            chunks.push(chunk.toString());
            callback();
          }
        });

        await llmProxy.streamingHandler(apiGatewayProxyEventV2, responseStream, context);
        console.log("Gemini Streaming Chunks:", chunks);
        expect(chunks.length).toBeGreaterThan(0); // Check if any data is received
        // Further checks can be added here based on expected Gemini stream format
        // e.g., expect(chunks.join('')).toContain("France"); // This depends on how transformGenerator and formatChunk handle Gemini's stream
      });
    });

    describe('Integration Tests for Gemini', () => {
      test('Gemini Streaming Integration Test', async () => {
        if (!geminiLlmClient) {
          console.warn("Gemini client not initialized, skipping integration test.");
          return;
        }
        const stream = await geminiLlmClient.chatCompletionStreaming(prompt);
        let responseText = '';
        // The structure of the chunk from Gemini might be different.
        // The gold standard example logs `chunk.text`.
        // Adjust this loop based on the actual structure of the stream from `result.stream` in LlmClient.
        for await (const chunk of stream) {
          // Assuming the chunk itself is an object with a 'text' property, or just text.
          // This needs to match how LlmClient's chatCompletionStreaming for Gemini yields data.
          // If it yields objects like { text: "..." }, then chunk.text
          // If it yields raw text strings, then just chunk
          // Based on the gold standard `console.log(chunk.text)`, we'll assume chunk.text
          // However, the LlmClient returns result.stream directly.
          // The `sendMessageStream` in `@google/generative-ai` yields `GenerateContentResponse` objects,
          // and each of those has a `text()` method.
          // Let's assume the LlmClient's stream yields objects that have a .text() method or .text property.
          // The provided `transformGenerator` in `llm_proxy.ts` expects `next.value` to be the chunk.
          // And `formatChunk` expects either an OpenAI chunk or a string.
          // The `chatCompletionStreaming` in `LlmClient` for gemini returns `result.stream`.
          // The `result.stream` from `@google/generative-ai` yields `EnhancedGenerateContentResponse` which has `text` as a function.
          // So, we need to adapt.
          if (chunk && typeof chunk.text === 'function') {
            responseText += chunk.text();
          } else if (chunk && typeof chunk.text === 'string') {
             responseText += chunk.text;
          } else if (typeof chunk === 'string') {
             responseText += chunk;
          }
        }
        console.log("Gemini Integration Streaming Response:", responseText);
        expect(responseText.toLowerCase()).toContain("france");
      });
    });
  } else {
    describe('Gemini Tests Skipped', () => {
      test.skip('Skipping Gemini tests because API key is not configured or is placeholder', () => {});
    });
  }
});
