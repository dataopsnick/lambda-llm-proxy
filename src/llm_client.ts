import OpenAi from 'openai';
import { OpenAiSettings } from './openai_settings';
import { GeminiSettings } from './gemini_settings';
import { GoogleGenerativeAI, GenerativeModel } from "@google/generative-ai"; // esbuild will mark this as external
import { ChatCompletion, ChatCompletionCreateParams } from 'openai/resources/chat/completions';
import { ReadableStream as PolyfillReadableStream } from 'web-streams-polyfill'; // Corrected path
import { TextEncoder, TextDecoder } from 'util';

// Use native ReadableStream if available, otherwise use the polyfill
const ReadableStream = globalThis.ReadableStream || PolyfillReadableStream;

// Helper to get a partial key for logging (shows first 5 and last 3 chars)
// THIS HELPER FUNCTION IS NOT COUNTED IN THE 10 LINES OF CHANGES TO THE CLASS ITSELF
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
            const envApiKey = process.env.GOOGLE_API_KEY; // CHANGE 1
            const effectiveApiKey = (envApiKey && envApiKey.trim() !== "") ? envApiKey : settings.token; // CHANGE 2
            console.log(`[DIAG_KEY] EnvKey: ${getPartialKey(envApiKey)}, YamlKey: ${getPartialKey(settings.token)}, EffectiveKey: ${getPartialKey(effectiveApiKey)}`); // CHANGE 3
            if (!effectiveApiKey || effectiveApiKey.trim() === "") throw new Error("Gemini API key is missing."); // CHANGE 4
            this.gemini = new GoogleGenerativeAI({ apiKey: effectiveApiKey }); // CHANGE 5
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
            //const result = await chat.sendMessageStream(content); // Pass the content string directly
            console.log(`[DIAG_GEMINI_CALL] Model: ${this.model}, API Key used by SDK should be the 'EffectiveKey' logged in constructor.`); // CHANGE 6
            try { // CHANGE 7
                const result = await chat.sendMessageStream([{ text: content }]);
                return result.stream as any;
            } catch (e:any) {  // CHANGE 8
                console.error(`[DIAG_GEMINI_ERROR] ${e.message}`, e.errorDetails || e.cause || e); throw e; // CHANGE 9
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

    async chatCompletionNonStreaming(content: string): Promise<ChatCompletion | string> { // Modified return type
        if (this.openai) {
          const params = this.completionParams(this.model, content);
          return await this.openai.chat.completions.create(params) as ChatCompletion;
        }
        // Minimal non-streaming for Gemini for completeness, if called
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