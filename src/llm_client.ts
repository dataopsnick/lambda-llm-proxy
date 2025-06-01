import OpenAi from 'openai';
import { OpenAiSettings } from './openai_settings';
import { GeminiSettings } from './gemini_settings';
import { GoogleGenerativeAI, GenerativeModel } from "@google/generative-ai";
import { ChatCompletion, ChatCompletionCreateParams } from 'openai/resources/chat/completions';
import { ReadableStream as PolyfillReadableStream } from 'web-streams-polyfill';
import fs from 'fs';

const ReadableStream = globalThis.ReadableStream || PolyfillReadableStream;

// Types for conversation history
interface ConversationMessage {
    role: string;
    content: string;
}

interface GeminiHistoryItem {
    role: string;
    parts: Array<{ text: string }>;
}

interface ConversationFile {
    conversation_history: ConversationMessage[] | any[];
    format: string;
    version: string;
}

export class LlmClient {
    public openai: OpenAi | null;
    public gemini: GoogleGenerativeAI | null;
    public model: string;
    public openaiSettings: OpenAiSettings | null;
    public geminiSettings: GeminiSettings | null;
    private conversationHistory: ConversationMessage[] = [];

    constructor(settings: OpenAiSettings | GeminiSettings) {
        if ('url' in settings) {
            // OpenAI Settings
            this.openaiSettings = settings;
            this.geminiSettings = null;
            this.openai = new OpenAi({
                baseURL: settings.url,
                apiKey: settings.token,
            });
            this.gemini = null;
        } else {
            // Gemini Settings
            this.geminiSettings = settings;
            this.openaiSettings = null;
            this.gemini = new GoogleGenerativeAI(settings.token);
            this.openai = null;
        }
        this.model = settings.model;
    }

    /**
     * Load conversation history from a file
     */
    loadConversationHistory(filePath: string): void {
        try {
            if (!fs.existsSync(filePath)) {
                console.log(`[CONVERSATION] History file not found: ${filePath}`);
                return;
            }

            const fileContent = fs.readFileSync(filePath, 'utf-8');
            const conversationFile: ConversationFile = JSON.parse(fileContent);
            
            console.log(`[CONVERSATION] Loading history format: ${conversationFile.format}`);
            console.log(`[CONVERSATION] History messages: ${conversationFile.conversation_history.length}`);

            if (conversationFile.format === 'openai_conversation') {
                this.conversationHistory = conversationFile.conversation_history as ConversationMessage[];
            } else if (conversationFile.format === 'gemini_conversation') {
                // Convert Gemini format to standardized format
                this.conversationHistory = this.convertGeminiToStandardHistory(conversationFile.conversation_history);
            }

            console.log(`[CONVERSATION] Loaded ${this.conversationHistory.length} messages`);
        } catch (error) {
            console.error(`[CONVERSATION] Error loading history: ${error}`);
            this.conversationHistory = [];
        }
    }

    /**
     * Convert Gemini conversation format to standard format
     */
    private convertGeminiToStandardHistory(geminiHistory: any[]): ConversationMessage[] {
        return geminiHistory.map(item => {
            // Extract text from parts array
            const textParts = item.parts
                ?.filter((part: any) => part.type === 'text')
                ?.map((part: any) => part.content) || [];
            
            return {
                role: item.role === 'model' ? 'assistant' : item.role,
                content: textParts.join('\n\n')
            };
        }).filter(msg => msg.content.trim().length > 0);
    }

    /**
     * Convert standard history to Gemini format
     */
    private convertToGeminiHistory(messages: ConversationMessage[]): GeminiHistoryItem[] {
        return messages.map(msg => ({
            role: msg.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: msg.content }]
        }));
    }

    /**
     * Merge conversation history with new messages
     */
    private mergeWithHistory(newMessages: ConversationMessage[]): ConversationMessage[] {
        return [...this.conversationHistory, ...newMessages];
    }

    async chatCompletionStreaming(messages: ConversationMessage[]): Promise<any> {
        const fullConversation = this.mergeWithHistory(messages);
        console.log(`[CONVERSATION] Total messages (with history): ${fullConversation.length}`);

        if (this.openai) {
            const params: ChatCompletionCreateParams = {
                model: this.model,
                messages: fullConversation as any,
                stream: true
            };
            const resp = await this.openai.chat.completions.create(params);
            return resp.toReadableStream() as any;
        } else if (this.gemini) {
            try {
                const model: GenerativeModel = this.gemini.getGenerativeModel({ model: this.model });
                
                // Convert to Gemini format and separate history from new message
                const geminiHistory = this.convertToGeminiHistory(fullConversation.slice(0, -1));
                const lastMessage = fullConversation[fullConversation.length - 1];
                
                console.log(`[GEMINI] Starting chat with ${geminiHistory.length} history messages`);
                
                const chat = model.startChat({
                    history: geminiHistory
                });
                
                const result = await chat.sendMessageStream([{ text: lastMessage.content }]);
                return result.stream as any;
            } catch (e: any) {
                console.error(`[GEMINI] Streaming error:`, e.message);
                throw e;
            }
        } else {
            throw new Error(`Unsupported provider`);
        }
    }

    async chatCompletionNonStreaming(messages: ConversationMessage[]): Promise<ChatCompletion | string> {
        const fullConversation = this.mergeWithHistory(messages);

        if (this.openai) {
            const params = {
                model: this.model,
                messages: fullConversation,
                stream: false
            } as OpenAi.Chat.Completions.ChatCompletionCreateParamsNonStreaming;
            return await this.openai.chat.completions.create(params) as ChatCompletion;
        } else if (this.gemini) {
            try {
                const model: GenerativeModel = this.gemini.getGenerativeModel({ model: this.model });
                
                const geminiHistory = this.convertToGeminiHistory(fullConversation.slice(0, -1));
                const lastMessage = fullConversation[fullConversation.length - 1];
                
                const chat = model.startChat({
                    history: geminiHistory
                });
                
                const result = await chat.sendMessage([{ text: lastMessage.content }]);
                return result.response.text();
            } catch (e: any) {
                console.error(`[GEMINI] Non-streaming error:`, e.message);
                throw e;
            }
        }
        throw new Error("Provider not supported");
    }

    /**
     * Clear conversation history
     */
    clearHistory(): void {
        this.conversationHistory = [];
        console.log(`[CONVERSATION] History cleared`);
    }

    /**
     * Add message to conversation history
     */
    addToHistory(role: string, content: string): void {
        this.conversationHistory.push({ role, content });
        console.log(`[CONVERSATION] Added ${role} message to history`);
    }

    /**
     * Get current conversation history
     */
    getHistory(): ConversationMessage[] {
        return [...this.conversationHistory];
    }

    // Legacy methods for backward compatibility
    async chatCompletionStreamingLegacy(content: string): Promise<any> {
        return this.chatCompletionStreaming([{ role: 'user', content }]);
    }

    async chatCompletionNonStreamingLegacy(content: string): Promise<ChatCompletion | string> {
        return this.chatCompletionNonStreaming([{ role: 'user', content }]);
    }
}