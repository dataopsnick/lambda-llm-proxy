import { getAllServerSettings } from './app_settings';
import { LlmProxy } from './llm_proxy';

const appSettings = getAllServerSettings();

export const llmProxy = new LlmProxy(appSettings)

export const handler = awslambda.streamifyResponse(llmProxy.streamingHandler)
