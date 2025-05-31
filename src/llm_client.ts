import OpenAi from 'openai';
import { OpenAiSettings } from './openai_settings';
import { GeminiSettings } from './gemini_settings';
import { GoogleGenerativeAI, GenerativeModel } from "@google/genai"; // esbuild will mark this as external
import { ChatCompletion, ChatCompletionCreateParams } from 'openai/resources/chat/completions';
import { ReadableStream as PolyfillReadableStream } from 'web-streams-polyfill'; // Corrected path
import { TextEncoder, TextDecoder } from 'util';

// Use native ReadableStream if available, otherwise use the polyfill
const ReadableStream = globalThis.ReadableStream || PolyfillReadableStream;

export class LlmClient {
    public openai: OpenAi | null;
    public gemini: GoogleGenerativeAI | null;
    public model: string;
    public openaiSettings: OpenAiSettings | null;
    public geminiSettings: GeminiSettings | null;


    constructor(settings: OpenAiSettings | GeminiSettings) {
        if ('url' in settings) {
            // It's OpenAiSettings
            this.openaiSettings = settings;
            this.geminiSettings = null;
            this.openai = new OpenAi({
                baseURL: settings.url,
                apiKey: settings.token,
            });
            this.gemini = null;
        } else {
            // It's GeminiSettings
            this.geminiSettings = settings;
            this.openaiSettings = null;
            this.gemini = new GoogleGenerativeAI({ apiKey: settings.token });
            this.openai = null;
        }

        this.model = settings.model;
    }

    private completionParams(model: string, content: string): any {
        return {
            model: model,
            messages: [{ role: 'user', content: content }],
        };
    }

    async chatCompletionStreaming(content: string): Promise<any> {
        if (this.openai) {
            const params: ChatCompletionCreateParams = {
                model: this.model,
                messages: [{ role: 'user', content: content }],
                stream: true
            };
            const resp = await this.openai.chat.completions.create(params);
            return resp.toReadableStream() as any;
        } else if (this.gemini) {
            const model: GenerativeModel = this.gemini.getGenerativeModel({ model: this.model });
            const chat = model.startChat({
                history: [], // IMPORTANT: Add history here later
            });

            const result = await chat.sendMessageStream({ message: content }); // Mimic example

            return result.stream as any;
        } else {
            throw new Error(`Unsupported provider`);
        }
    }

    async createCompletionStreaming(params: any): Promise<any | null> {
        try {
            const resp = await this.openai?.chat.completions.create(params);
            if (!resp) {
                return null;
            }
            return new ReadableStream({
                async start(controller: any) {
                    if (resp.choices) {
                        for await (const chunk of resp) {
                            if (chunk.choices && chunk.choices[0] && chunk.choices[0].delta && chunk.choices[0].delta.content) {
                                controller.enqueue(new TextEncoder().encode(chunk.choices[0].delta.content));
                            }
                        }
                    }
                    controller.close();
                }
            });
        } catch (error) {
            console.error("Error in createCompletionStreaming:", error);
            return null;
        }
    }

    async chatCompletionNonStreaming(content: string): Promise<ChatCompletion> {
        if (this.openai) {
          const params = this.completionParams(this.model, content);
          return await this.openai.chat.completions.create(params) as ChatCompletion;
        }
        throw new Error("Not implemented");
    }

    async createCompletionNonStreaming(params: OpenAi.Chat.Completions.ChatCompletionCreateParamsNonStreaming): Promise<OpenAi.Chat.Completions.ChatCompletion> {
        let response = await this.openai.chat.completions.create(params);
        if (typeof response === 'string' || response instanceof String) {
            let responseStr = response as unknown as string;
            response = JSON.parse(responseStr);
        }
        return response;
    }
}
