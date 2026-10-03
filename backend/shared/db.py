import os
import boto3

dynamodb = boto3.resource("dynamodb")
FILES_TABLE = os.getenv("FILES_TABLE", "files")
Audit_TABLE = os.getenv("AUDIT_TABLE", "audit")

def get_table(table_name: str):
    return dynamodb.Table(table_name)

def put_file(file_data:dict):
    table = get_table(FILES_TABLE)
    table.put_item(Item=file_data)

def get_file(file_id: str):
    table = get_table(FILES_TABLE)

response = table.get_item(
    Key={"file_id": file_id}
)
return response.get("Item")

def delete_file(file_id: str):
    table = get_table(FILES_TABLE)
    table.delete_item(
        Key = {"file_id": file_id}
    )

def put_audit_entry(entry: dict):
    table = get_table(AUDIT_TABLE)
    table.put_item(Item=entry) 

def get_audit_entries(file_id: str):
    table = get_table(AUDIT_TABLE)
    response = table.query(
        KeyConditionsExpresstion = boto3.dynamodb.conditions.Key(
            "file_id"
        ).eq(file_id)
    )
    return response.get("Items", [])
