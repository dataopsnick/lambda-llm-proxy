# OpenAI compatible API proxy running on AWS Lambda

This AWS Lambda handler acts a proxy to call a Large Language Model.


A typical dependency chain looks like

`Typescript openAI client` => `API Gateway` => `Lambda openAI proxy` => `OpenAI server`

The benefits of inserting a proxy between the frontend and the model inference service include

- Access control
- Throttling
- Logging
- Metrics
- Caching

It is a security requirement to distribute your Generative AI app without sharing your access token associated with your LLM provider of choice. After finetuning a base model with Lora, the merged model can be deployed to *huggingface.com* / *replicate.com* or the adapter to *predibase.com*.


## Examples


|LLM service|Description|url|model|
|---|---|---|---|
|OpenAI|Run GPT-4o model with your OpenAI token|https://api.openai.com/v1|gpt-4o|
|Mistral|Run Mistral Large model with your Mistral token|https://api.mistral.ai/v1|mistral-large-latest|
|Predibase|Run a fine-tuned Mistral model, with QLora adapter hosted on Predibase|https://serving.app.predibase.com/userId/deployments/v2/llms/mistral-7b-instruct-v0-3/v1|""|
|Ollama|Run quantized Mistral model locally.|http://localhost:11434/v1|mistral:latest|


## Configuration

- Overwrite the proxy url to the public streaming function url. Enable authorization before launch.
- Overwrite the server url and token to the public LLM server.

### Env

In Lambda function env variables in the SAM template, specify *any* OpenAI compatible API.

```
template.yaml

  OPENAI_PROXY_URL: https://abcdefghijklmnopqrstuvwxyz.lambda-url.us-west-2.on.aws/
  OPENAI_PROXY_KEY: apiKey
  OPENAI_SERVER_URL: https://serving.app.predibase.com/userId/deployments/v2/llms/mistral-7b-instruct-v0-3/v1
  OPENAI_SERVER_KEY: pb_0123456789
```

Above `OPENAI_SERVER_URL` uses predibase endpoint, but OpenAI, Mistral, or Ollama urls should work.

### Test

```
$ npm run test

 PASS  src/index.test.ts (40.713 s)
  app
    Unit
      ✓ Streaming (36026 ms)
      ✓ Non Streaming (594 ms)
    Integration
      ✓ Streaming (2200 ms)
      ✓ Non streaming (675 ms)

Test Suites: 1 passed, 1 total
Tests:       4 passed, 4 total
Snapshots:   0 total
Time:        40.772 s
Ran all test suites.
```


### Build

```
$ npm run build
```

Transpilation will update the `dist` folder with the `index.js` file pending deployment to Lambda code.

### Deploy

Create the Lambda function using the provided SAM template.

Deploy the code.

```
sam deploy --guided
```