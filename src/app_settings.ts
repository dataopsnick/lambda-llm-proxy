import { OpenAiServerSettings } from "./openai_settings";

import fs from 'fs';
import * as YAML from 'yaml';

export const getOpenAiServerSettings = (): OpenAiServerSettings => {
    const config = fs.readFileSync('./openai_servers.yaml').toString();
    return YAML.parse(config) as OpenAiServerSettings;
}