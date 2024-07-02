export interface OpenAiSettings {
    url: string;
    token: string;
    model: string;
}

export interface OpenAiServerSettings {
    [server: string] : OpenAiSettings;
}