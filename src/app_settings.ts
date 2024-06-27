import { OpenAiProxySettings } from "./openai_settings";

export const getAppSettings = (): OpenAiProxySettings => {
    return {
        lambdaProxy: {
            baseUrl: process.env.OPENAI_PROXY_URL!,
            apiKey: process.env.OPENAI_PROXY_KEY!,
        },
        openaiServer: {
            baseUrl: process.env.OPENAI_SERVER_URL!,
            apiKey: process.env.OPENAI_SERVER_KEY!,
        },
        model: '',
    }
}