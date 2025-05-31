import { OpenAiServerSettings, OpenAiSettings } from "./openai_settings";
import { GeminiSettings } from "./gemini_settings";
import fs from 'fs';
import * as YAML from 'yaml';

export type ServerSettings = OpenAiSettings | GeminiSettings;
export type AllServerSettings = Record<string, ServerSettings>;

export const getAllServerSettings = (): AllServerSettings => {
    const config = fs.readFileSync('./openai_servers.yaml').toString();
    const parsedConfig = YAML.parse(config);

    const settings: AllServerSettings = {};

    for (const serverName in parsedConfig) {
        const serverConfig = parsedConfig[serverName];
        if (serverConfig && typeof serverConfig === 'object') {
            if ('url' in serverConfig) {
                settings[serverName] = serverConfig as OpenAiSettings;
            } else {
                settings[serverName] = serverConfig as GeminiSettings;
            }
        }
    }
    return settings;
}
