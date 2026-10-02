import json
import boto3
from prompt import SYSTEM_PROMPT

bedrock = boto3.client("bedrock-runtime", region_name="us-east-1")

def classify_text(text: str) -> dict:
    body = json.dumps({
        "system": [{"text": SYSTEM_PROMPT}],
        "messages": [
            {
                "role": "user",
                "content": [{"text": f"Analyze this financial document excerpt:\n\n{text[:4000]}"}]
            }
        ],
        "inferenceConfig": {
            "maxTokens": 500,
            "temperature": 0.0
        }
    })

    response = bedrock.invoke_model(
        modelId="amazon.nova-micro-v1:0",
        contentType="application/json",
        accept="application/json",
        body=body
    )

    result = json.loads(response["body"].read())
    content = result["output"]["message"]["content"][0]["text"].strip()

    if content.startswith("```json"):
        content = content[7:-3].strip()
    elif content.startswith("```"):
        content = content[3:-3].strip()

    return json.loads(content)
