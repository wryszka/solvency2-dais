"""Foundation Model API wrapper with MLflow Tracing and AI Gateway support.

Tries Claude Sonnet (via Databricks external model endpoint) first,
falls back to Meta Llama 3.3 70B Instruct.

All calls are traced via MLflow for Mosaic AI observability.
"""

import logging
import os
from dataclasses import dataclass

from databricks.sdk import WorkspaceClient
from databricks.sdk.service.serving import ChatMessage, ChatMessageRole

from server.config import get_workspace_client

logger = logging.getLogger(__name__)

# MLflow tracing — initialise if available
try:
    import mlflow
    mlflow.set_tracking_uri("databricks")
    _MLFLOW_AVAILABLE = True
    logger.info("MLflow tracing enabled")
except ImportError:
    _MLFLOW_AVAILABLE = False
    logger.info("MLflow not available — tracing disabled")

# AI Gateway endpoint (if configured, routes through gateway for content filtering)
AI_GATEWAY_ENDPOINT = os.getenv("AI_GATEWAY_ENDPOINT", "")

# Model preference order — configurable via the FM_MODEL_ENDPOINTS env var
# (comma-separated list, declared in app.yaml from bundle var). Empty/unset
# falls back to the Claude-then-Llama preference that works on standard
# Databricks workspaces.
#
# For free-edition Databricks workspaces the default Foundation Model endpoint
# is `databricks-gpt-oss-120b` (GPT-OSS-120B from OpenAI) — set
# `fm_model_endpoints: "databricks-gpt-oss-120b"` in databricks.yml to use it.
#
# The app probes each endpoint in order and uses the first one that's READY.
_FM_DEFAULT = [
    "databricks-claude-sonnet-4",
    "databricks-claude-3-7-sonnet",
    "databricks-meta-llama-3-3-70b-instruct",
]
_FM_ENV = os.getenv("FM_MODEL_ENDPOINTS", "").strip()
MODEL_ENDPOINTS = [s.strip() for s in _FM_ENV.split(",") if s.strip()] if _FM_ENV else _FM_DEFAULT

_active_endpoint: str | None = None


@dataclass
class AiResponse:
    text: str
    model_used: str
    input_tokens: int
    output_tokens: int


def _probe_endpoint(client: WorkspaceClient, endpoint: str) -> bool:
    """Check if a serving endpoint exists and is ready."""
    try:
        ep = client.serving_endpoints.get(endpoint)
        if ep.state and ep.state.ready == "READY":
            return True
        return ep is not None
    except Exception:
        return False


def _find_endpoint(client: WorkspaceClient) -> str:
    """Find the first available model endpoint."""
    global _active_endpoint
    if _active_endpoint:
        return _active_endpoint

    # Prefer AI Gateway if configured
    if AI_GATEWAY_ENDPOINT:
        if _probe_endpoint(client, AI_GATEWAY_ENDPOINT):
            logger.info("Using AI Gateway endpoint: %s", AI_GATEWAY_ENDPOINT)
            _active_endpoint = AI_GATEWAY_ENDPOINT
            return AI_GATEWAY_ENDPOINT

    for endpoint in MODEL_ENDPOINTS:
        if _probe_endpoint(client, endpoint):
            logger.info("Using model endpoint: %s", endpoint)
            _active_endpoint = endpoint
            return endpoint

    raise RuntimeError(
        f"No model endpoint available. Tried: {', '.join(MODEL_ENDPOINTS)}. "
        "Please enable a Foundation Model endpoint in your workspace."
    )


def _call_llm(system_prompt: str, user_prompt: str, agent_name: str = "unknown") -> AiResponse:
    """Call Foundation Model API (synchronous, runs in thread)."""
    client = get_workspace_client()
    endpoint = _find_endpoint(client)

    response = client.serving_endpoints.query(
        name=endpoint,
        messages=[
            ChatMessage(role=ChatMessageRole.SYSTEM, content=system_prompt),
            ChatMessage(role=ChatMessageRole.USER, content=user_prompt),
        ],
        max_tokens=2048,
        temperature=0.2,
    )

    text = ""
    if response.choices:
        msg = response.choices[0].message
        if msg:
            text = msg.content or ""

    input_tokens = 0
    output_tokens = 0
    if response.usage:
        input_tokens = response.usage.prompt_tokens or 0
        output_tokens = response.usage.completion_tokens or 0

    return AiResponse(
        text=text,
        model_used=endpoint,
        input_tokens=input_tokens,
        output_tokens=output_tokens,
    )


def _call_llm_traced(system_prompt: str, user_prompt: str, agent_name: str = "unknown") -> AiResponse:
    """Call LLM with MLflow tracing if available."""
    if _MLFLOW_AVAILABLE:
        with mlflow.start_span(name=f"agent.{agent_name}") as span:
            span.set_inputs({
                "agent": agent_name,
                "system_prompt_length": len(system_prompt),
                "user_prompt_length": len(user_prompt),
            })
            result = _call_llm(system_prompt, user_prompt, agent_name)
            span.set_outputs({
                "model_used": result.model_used,
                "input_tokens": result.input_tokens,
                "output_tokens": result.output_tokens,
                "response_length": len(result.text),
            })
            return result
    else:
        return _call_llm(system_prompt, user_prompt, agent_name)


async def generate_review(
    system_prompt: str,
    user_prompt: str,
    agent_name: str = "actuarial_review",
) -> AiResponse:
    """Call Foundation Model API with the given prompts. Traced via MLflow."""
    import asyncio
    return await asyncio.to_thread(_call_llm_traced, system_prompt, user_prompt, agent_name)


# ── Tool calling support (for supervisor agent) ──────────────────────────────

def _call_llm_with_tools(
    messages: list,
    tools: list,
    agent_name: str = "supervisor",
    max_tokens: int = 2048,
) -> dict:
    """Call LLM with tool definitions. Returns the raw response message dict.

    messages: list of {"role": "...", "content": "..."} or with tool_calls / tool_call_id
    tools: list of {"type": "function", "function": {...}} OpenAI-style tool defs
    """
    client = get_workspace_client()
    endpoint = _find_endpoint(client)

    # Use the SDK's raw API call for tool support
    import json as _json
    from databricks.sdk.service.serving import ChatMessage, ChatMessageRole

    # Build SDK-friendly messages (tool roles need special handling)
    sdk_messages = []
    for m in messages:
        role = m.get("role", "user")
        content = m.get("content", "") or ""
        if role == "tool":
            # Tool result — represent as user message with structured prefix
            sdk_messages.append(ChatMessage(
                role=ChatMessageRole.USER,
                content=f"[Tool result for {m.get('name','tool')} (call {m.get('tool_call_id','')[:8]})]\n{content}",
            ))
        elif role == "assistant":
            # Assistant — may include tool_calls
            tool_calls = m.get("tool_calls", [])
            if tool_calls:
                # Represent tool calls as text the next call can see
                tc_text = "\n".join([
                    f"[Tool call: {tc['function']['name']}({tc['function']['arguments']})]"
                    for tc in tool_calls
                ])
                sdk_messages.append(ChatMessage(role=ChatMessageRole.ASSISTANT, content=content + "\n" + tc_text))
            else:
                sdk_messages.append(ChatMessage(role=ChatMessageRole.ASSISTANT, content=content))
        elif role == "system":
            sdk_messages.append(ChatMessage(role=ChatMessageRole.SYSTEM, content=content))
        else:
            sdk_messages.append(ChatMessage(role=ChatMessageRole.USER, content=content))

    # Call with tools via raw HTTP since SDK doesn't expose tools cleanly
    import urllib.request
    import urllib.error
    workspace_host = client.config.host.rstrip("/")
    token = client.config.authenticate().get("Authorization", "").replace("Bearer ", "")

    payload = {
        "messages": [{"role": m.get("role"), "content": m.get("content"),
                      **({"tool_calls": m["tool_calls"]} if m.get("tool_calls") else {}),
                      **({"tool_call_id": m["tool_call_id"]} if m.get("tool_call_id") else {}),
                      **({"name": m["name"]} if m.get("name") else {})}
                     for m in messages],
        "tools": tools,
        "max_tokens": max_tokens,
        "temperature": 0.2,
    }

    req = urllib.request.Request(
        f"{workspace_host}/serving-endpoints/{endpoint}/invocations",
        data=_json.dumps(payload).encode(),
        method="POST",
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            data = _json.loads(resp.read())
    except urllib.error.HTTPError as e:
        body = e.read().decode()[:500]
        raise RuntimeError(f"LLM call failed: {e.code} — {body}")

    msg = data.get("choices", [{}])[0].get("message", {})
    usage = data.get("usage", {})
    return {
        "message": msg,
        "model_used": endpoint,
        "input_tokens": usage.get("prompt_tokens", 0),
        "output_tokens": usage.get("completion_tokens", 0),
    }


async def call_with_tools(messages: list, tools: list, agent_name: str = "supervisor") -> dict:
    """Async wrapper for tool-calling LLM."""
    import asyncio
    return await asyncio.to_thread(_call_llm_with_tools, messages, tools, agent_name)


def reset_endpoint_cache():
    """Reset cached endpoint (for testing or after config change)."""
    global _active_endpoint
    _active_endpoint = None
