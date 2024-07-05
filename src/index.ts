import { getOpenAiServerSettings } from './app_settings';
import { LlmProxy } from './llm_proxy';

const appSettings = getOpenAiServerSettings();

export const llmProxy = new LlmProxy(appSettings)

// @ts-expect-error
export const handler = awslambda.streamifyResponse(llmProxy.streamingHandler)