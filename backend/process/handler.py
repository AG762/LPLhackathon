"""Placeholder so the stack deploys; replaced by the real `process` Lambda (STORIES.md C.3)."""
import logging

logger = logging.getLogger()
logger.setLevel(logging.INFO)


def main(event, context):
    for record in event.get("Records", []):
        logger.info("Uploaded: %s", record["s3"]["object"]["key"])
    return {"ok": True}
