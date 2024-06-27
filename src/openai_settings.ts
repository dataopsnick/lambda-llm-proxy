export interface OpenAiSettings {
    baseUrl: string;
    apiKey: string;
}

export interface OpenAiProxySettings {
    lambdaProxy: OpenAiSettings;
    openaiServer: OpenAiSettings;
    model: string;
}