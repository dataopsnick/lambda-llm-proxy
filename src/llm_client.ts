import OpenAi from 'openai';
import { OpenAiSettings } from './openai_settings';
import { GeminiSettings } from './gemini_settings';
import { GoogleGenerativeAI, GenerativeModel } from "@google/generative-ai";
import { ChatCompletion, ChatCompletionCreateParams } from 'openai/resources/chat/completions';
import { ReadableStream as PolyfillReadableStream } from 'web-streams-polyfill';
import { TextEncoder, TextDecoder } from 'util';

const ReadableStream = globalThis.ReadableStream || PolyfillReadableStream;

const getPartialKey = (key: string | undefined | null): string => {
    if (!key || key.length < 8) {
        return key || "undefined/empty";
    }
    return `${key.substring(0, 5)}...${key.substring(key.length - 3)}`;
};

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
            
            // EXTENSIVE DEBUG LOGGING
            const envApiKey = process.env.GOOGLE_API_KEY;
            const yamlApiKey = settings.token;
            
            console.log(`[DEBUG_ENV] All environment variables:`, Object.keys(process.env).filter(k => k.includes('API') || k.includes('KEY') || k.includes('GOOGLE')));
            console.log(`[DEBUG_ENV] GOOGLE_API_KEY exists:`, envApiKey !== undefined);
            console.log(`[DEBUG_ENV] GOOGLE_API_KEY value:`, getPartialKey(envApiKey));
            console.log(`[DEBUG_YAML] YAML token value:`, getPartialKey(yamlApiKey));
            
            // Use YAML config by default (since local works with YAML)
            const effectiveApiKey = yamlApiKey;
            
            console.log(`[DEBUG_EFFECTIVE] Using API key:`, getPartialKey(effectiveApiKey));
            console.log(`[DEBUG_EFFECTIVE] Key length:`, effectiveApiKey?.length);
            console.log(`[DEBUG_EFFECTIVE] Key starts with AIza:`, effectiveApiKey?.startsWith('AIza'));
            
            if (!effectiveApiKey || effectiveApiKey.trim() === "") {
                throw new Error("Gemini API key is missing");
            }
            
            // Log the exact constructor call
            console.log(`[DEBUG_CONSTRUCTOR] About to call GoogleGenerativeAI constructor`);
            console.log(`[DEBUG_CONSTRUCTOR] Constructor argument type:`, typeof effectiveApiKey);
            
            try {
                // Try different ways of passing the API key
                console.log(`[DEBUG_CONSTRUCTOR] Method 1: Direct string`);
                this.gemini = new GoogleGenerativeAI(effectiveApiKey);
                console.log(`[DEBUG_CONSTRUCTOR] GoogleGenerativeAI created successfully`);
                
                // Test the client immediately
                console.log(`[DEBUG_TEST] Testing client initialization...`);
                const testModel = this.gemini.getGenerativeModel({ model: 'gemini-2.0-flash' });
                console.log(`[DEBUG_TEST] Model instance created successfully`);
                
            } catch (initError: any) {
                console.error(`[DEBUG_ERROR] GoogleGenerativeAI constructor failed:`, initError.message);
                
                // Try alternative constructor format
                console.log(`[DEBUG_CONSTRUCTOR] Method 2: Object format`);
                try {
                    this.gemini = new GoogleGenerativeAI({ apiKey: effectiveApiKey });
                    console.log(`[DEBUG_CONSTRUCTOR] GoogleGenerativeAI created with object format`);
                } catch (altError: any) {
                    console.error(`[DEBUG_ERROR] Alternative constructor also failed:`, altError.message);
                    throw initError;
                }
            }
            
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
            console.log(`[DEBUG_STREAM] Starting streaming with model: ${this.model}`);
            console.log(`[DEBUG_STREAM] Content: ${content.substring(0, 50)}...`);
            
            try {
                const model: GenerativeModel = this.gemini.getGenerativeModel({ model: this.model });
                console.log(`[DEBUG_STREAM] Model instance obtained`);
                
                const chat = model.startChat({ history: [] });
                console.log(`[DEBUG_STREAM] Chat started`);
                
                console.log(`[DEBUG_STREAM] About to call sendMessageStream...`);
                const result = await chat.sendMessageStream([{ text: content }]);
                console.log(`[DEBUG_STREAM] sendMessageStream succeeded`);
                
                return result.stream as any;
            } catch (e: any) {
                console.error(`[DEBUG_STREAM_ERROR] Stream error:`, e.message);
                console.error(`[DEBUG_STREAM_ERROR] Error details:`, JSON.stringify(e.errorDetails || {}, null, 2));
                console.error(`[DEBUG_STREAM_ERROR] Error cause:`, JSON.stringify(e.cause || {}, null, 2));
                console.error(`[DEBUG_STREAM_ERROR] Full error:`, e);
                throw e;
            }
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

    async chatCompletionNonStreaming(content: string): Promise<ChatCompletion | string> {
        if (this.openai) {
            const params = this.completionParams(this.model, content);
            return await this.openai.chat.completions.create(params) as ChatCompletion;
        }
        if (this.gemini) {
            const model: GenerativeModel = this.gemini.getGenerativeModel({ model: this.model });
            const chat = model.startChat({ history: [] });
            const result = await chat.sendMessage([{ text: content }]);
            return result.response.text();
        }
        throw new Error("Not implemented for this provider for non-streaming or client not initialized.");
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