"""Print frontend .env settings for a deployed stack (API URL + Cognito sign-in), from its outputs.

    python3 scripts/frontend_env.py --stack shredsafe-login > frontend/.env.logintest.local
    cd frontend && VITE_ROUTER_BASE=/ports/5173 npx vite build --base ./ --mode logintest \\
        && npx vite preview --host --port 5173

Vite loads .env.<mode>.local for --mode <mode>; *.local files are gitignored.
"""
import argparse
import os

import boto3

KEYS = {
    "ApiUrl": "VITE_API_URL",
    "UserPoolId": "VITE_COGNITO_USER_POOL_ID",
    "UserPoolClientId": "VITE_COGNITO_CLIENT_ID",
}


def env_lines(outputs, demo_controls=True):
    found = {o["OutputKey"]: o["OutputValue"] for o in outputs}
    missing = [k for k in KEYS if k not in found]
    if missing:
        raise SystemExit(f"Stack is missing outputs: {', '.join(missing)}")
    lines = [f"{env}={found[out].rstrip('/')}" for out, env in KEYS.items()]
    lines += ["VITE_API_MODE=live", f"VITE_DEMO_CONTROLS={'true' if demo_controls else 'false'}"]
    return lines


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--stack", default="shredsafe")
    parser.add_argument("--region", default=os.environ.get("AWS_REGION", "us-east-1"))
    parser.add_argument("--no-demo-controls", action="store_true")
    args = parser.parse_args(argv)
    cfn = boto3.client("cloudformation", region_name=args.region)
    outputs = cfn.describe_stacks(StackName=args.stack)["Stacks"][0].get("Outputs", [])
    print("\n".join(env_lines(outputs, demo_controls=not args.no_demo_controls)))


if __name__ == "__main__":
    main()
