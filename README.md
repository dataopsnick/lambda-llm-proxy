# OpenAI compatible API proxy running on AWS Lambda

This AWS Lambda handler acts as a proxy to call a Large Language Model.


## Architecture

![OpenAI proxy](ArchitectureOpenAIProxy.png)

The benefits of inserting a proxy between the frontend and the model inference service include

- Access control
- Throttling
- Logging
- Metrics
- Caching

The steps involved in deploying your own LLM include

1. Build a training dataset
2. Finetune a base LLM with QLora
3. Evaluate the predictions
4. Merge the QLora adapter with the base model
5. Deploy the merged model

Great options facilitate deploying the model. They provide public API endpoints for LLM inference with token-based authentication:

* huggingface.com
* replicate.com
* modal.com
* predibase.com

But you still need a dedicated backend API to hide the token from your client. It is a security requirement to distribute your Generative AI app without sharing your access token associated with your LLM provider of choice.

### Preferred option

The NodeJS handler runs on a Lambda *streaming* function. The response it sends is an *Event Stream*, a particular case of *Server Side Events*. Lambda will temporarily buffer messages before flushing them to the client. After testing, the buffering delay was not noticeable when summarizing a large PDF. The app was still reactive with live updates during the sequence generation.

### Alternatives considered

Introducing websockets or Server Side Events woud also provide instaneous feedback.

- Sending notifications to the websocket is possible when running a Lambda function through REST. This would require adding another API Gateway custom API in the stack, as well as managing websocket in the frontend.

- Sending live Server Side Events is possible on another AWS compute than Lambda, such as ECS/Fargate. However it would no longer be serverless.

## Examples


|LLM service|Description|model|
|---|---|---|
|OpenAI|Run GPT-4o model with your OpenAI token|gpt-4o|
|Mistral|Run Mistral Large model with your Mistral token|mistral-large-latest|
|Replicate|Run Mistral Open Source model with your Replicate token|mistralai/mistral-7b-instruct-v0.2|
|Predibase|Run a fine-tuned Open Source Mistral model, with QLora adapter|""|
|Ollama|Run quantized Mistral model locally.|mistral:latest|


## Configuration

Use the lambda public url as the host in openai client library. Enable authorization before launch.

When calling the proxy, prepend the server key (`openai` | `mistral` | `replicate` | `predibase`) in the path of the url. For example to call `replicate`, the host url is `https://abcdefghijklmnopqrstuvwxyz.lambda-url.us-west-2.on.aws/replicate/v1/chat/completions`.


### YAML server configuration

Update `openai_servers.yaml` with the list of OpenAI API compatible servers to support.

```
proxy:
  url: https://abcdefghijklmnopqrstuvwxyz.lambda-url.us-west-2.on.aws/replicate/v1
  token: api_key
  model: mistralai/mistral-7b-instruct-v0.2
openai:
  url: https://api.openai.com/v1
  token: sk-proj-...
  model: gpt-4o
mistral:
  url: https://api.mistral.ai/v1
  token: ...
  model: mistral-large-latest
replicate:
  url: https://openai-proxy.replicate.com/v1
  token: r8_...
  model: mistralai/mistral-7b-instruct-v0.2
predibase:
  url: https://serving.app.predibase.com/028bc858/deployments/v2/llms/mistral-7b-instruct-v0-3/v1
  token: pb_...
  model: ""
ollama:
  url: http://127.0.0.1:11434/v1
  token: ollama_token
  model: mistral:latest
```

## Clients
### curl

```
ENDPOINT=https://abcdefghijklmnopqrstuvwxyz.lambda-url.us-west-2.on.aws/replicate/v1
API_TOKEN=api_token
MODEL=meta/meta-llama-3-70b-instruct

curl "$ENDPOINT/chat/completions" \
    -d '{ "model": "$MODEL, "messages": [ { "role": "user", "content": "Tell me a joke" } ], "stream": true }' \
    -H 'Content-Type: application/json' \
    -H "Authorization: Bearer $API_TOKEN" \
```

### NodeJS

Here's the client code,

```JavaScript
import OpenAi from 'openai';


const server = 'replicate';
const baseURL = `https://abcdefghijklmnopqrstuvwxyz.lambda-url.us-west-2.on.aws/${server}/v1/`;
const apiKey = 'r8_...';
const openAi = new OpenAi({
    baseURL: baseURL,
    apiKey: apiKey,
});

const model = 'mistralai/mistral-7b-instruct-v0.2';
const prompt = 'Tell me a joke.'
const params = {
    model: model,
    messages: [{ role: 'user', content: prompt }],
    stream: true,
};

const chunks = await openai.chat.completions.create(params);
let response = '';
for await (const chunk of chunks) {
  response += chunk.choices[0].delta.content;
  updateAssistantResponse(response);
}

```

### Python

Works in Google Colab

```Python
from anyio import run
from openai import AsyncOpenAI

# Configuration
server = 'gemini'
base_url = f'https://abcdefghijklmnopqrstuvwxyz.lambda-url.us-west-2.on.aws/{server}/v1/'
api_key = 'GEMINI_API_KEY'  # Use the same token as in your YAML

# Create OpenAI client
openai = AsyncOpenAI(
    base_url=base_url,
    api_key=api_key,
)

async def main():
    model = 'gemini-2.0-flash'
    prompt = 'Tell me a joke.'

    params = {
        'model': model,
        'messages': [{'role': 'user', 'content': prompt}],
        'stream': True,
    }

    # Create streaming chat completion
    chunks = await openai.chat.completions.create(**params)
    response = ''

    # Iterate through streaming chunks
    async for chunk in chunks:
        if chunk.choices and chunk.choices[0].delta.content:
            content = chunk.choices[0].delta.content
            response += content
            print(content, end='', flush=True)

    print(f"\n\nFull response: {response}")

# Run the async function
await main()```

### Test

```
$ npm run test

 PASS  src/tests/index.test.ts (7.044 s)
  app
    Unit
      ✓ Streaming (1499 ms)
      ✓ Non Streaming (1508 ms)
      ○ skipped Above 32k context size
    Integration
      ✓ Streaming (847 ms)
      ✓ Non streaming (1342 ms)
```


### Build

Transpilation will update the `dist` folder with the `index.js` file pending deployment to Lambda code.
Include the configuration file containing the api tokens of the supported LLM servers.

```
$ npm run build
$ cp openai_servers.yaml dist/
```


### Deploy

Create the Lambda function using the provided SAM template.

Deploy the code.

```
sam deploy --guided
```