import OpenAi from 'openai';
import { Stream } from 'openai/streaming';
import { OpenAiSettings } from './openai_settings';

export class LlmClient {
    private openai: OpenAi;
    private model: string;

    constructor(settings: OpenAiSettings, model: string) {
        this.openai = this.getClient(settings);
        this.model = model;
    }

    getClient(settings: OpenAiSettings) : OpenAi {
        return new OpenAi({
            baseURL: settings.baseUrl,
            apiKey: settings.apiKey,
        });
    }

    completionParams(model: string, content: string) : any {
        return {
            model: model,
            messages: [ { role: 'user', content: content } ],
        };
    }

    completionParamsStreaming(content: string) : OpenAi.Chat.Completions.ChatCompletionCreateParamsStreaming {
        return {
            ...this.completionParams(this.model, content),
            stream: true
        };
    }

    completionParamsNonStreaming(content: string) : OpenAi.Chat.Completions.ChatCompletionCreateParamsNonStreaming {
        return {
            ...this.completionParams(this.model, content),
        };
    }

    async chatCompletionStreaming(content: string) : Promise<Stream<OpenAi.Chat.Completions.ChatCompletionChunk>> {
        const params = this.completionParamsStreaming(content);
        return await this.createCompletionStreaming(params);
    }

    async createCompletionStreaming(params: OpenAi.Chat.Completions.ChatCompletionCreateParamsStreaming) : Promise<Stream<OpenAi.Chat.Completions.ChatCompletionChunk>> {
        return await this.openai.chat.completions.create(params);
    }

    async chatCompletionNonStreaming(content: string) : Promise<OpenAi.Chat.Completions.ChatCompletion> {
        const params = this.completionParamsNonStreaming(content);
        return await this.createCompletionNonStreaming(params);
    }

    async createCompletionNonStreaming(params: OpenAi.Chat.Completions.ChatCompletionCreateParamsNonStreaming) : Promise<OpenAi.Chat.Completions.ChatCompletion> {
        let response = await this.openai.chat.completions.create(params);
        if (typeof response === 'string' || response instanceof String) {
            let responseStr = response as unknown as string;
            response = JSON.parse(responseStr);
        }
        return response;
    }
}