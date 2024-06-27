import { getAppSettings } from './app_settings'
import { LlmProxy } from './llm_proxy'

const appSettings = getAppSettings();

export const llmProxy: LlmProxy = new LlmProxy(appSettings.openaiServer)

// @ts-expect-error
export const handler = awslambda.streamifyResponse(llmProxy.streamingHandler)