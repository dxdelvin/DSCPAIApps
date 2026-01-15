import httpx
import os
import re
from typing import Optional
from fastapi import HTTPException
from app.services.brain_auth import get_brain_access_token


def _extract_xml(text: str) -> str:
    """Extract BPMN XML from the AI response"""
    pattern = r"(<\?xml.*?<bpmn2?:definitions.*?</bpmn2?:definitions>)"
    match = re.search(pattern, text, re.DOTALL | re.IGNORECASE)
    if match:
        return match.group(1).strip()

    secondary_pattern = r"(<bpmn2?:definitions.*?</bpmn2?:definitions>)"
    secondary_match = re.search(secondary_pattern, text, re.DOTALL | re.IGNORECASE)
    if secondary_match:
        return secondary_match.group(1).strip()

    return text.strip()

# to check if the env files are working or not! Just DEBUG in UI
def _require_env(value: str, name: str) -> str:
    if not value:
        raise HTTPException(status_code=500, detail=f"Missing configuration: {name}")
    return value


async def call_brain_chat(brain_id: str, prompt: str, *, use_gpt_knowledge: bool = True, chat_history_id: Optional[str] = None):
    """Call DIA Brain retrieval-augmented chat with the provided Brain (knowledgeBaseId)."""
    proxy_url = "http://rb-proxy-de.bosch.com:8080"
    os.environ["HTTP_PROXY"] = proxy_url
    os.environ["HTTPS_PROXY"] = proxy_url

    base_url = os.getenv("BRAIN_API_BASE_URL")
    _require_env(base_url, "BRAIN_API_BASE_URL")
    _require_env(brain_id, "knowledgeBaseId")

    token = await get_brain_access_token()

    url = f"{base_url}/chat/retrieval-augmented"
    headers = {
        "Authorization": f"Bearer {token}",
        "User-Agent": "PostmanRuntime/7.37.3",
        "Content-Type": "application/json"
    }
    payload = {
        "prompt": prompt,
        "knowledgeBaseId": brain_id,
        "useGptKnowledge": use_gpt_knowledge,
    }
    if chat_history_id:
        payload["chatHistoryId"] = chat_history_id

    async with httpx.AsyncClient(verify=False, trust_env=True) as client:
        try:
            response = await client.post(url, json=payload, headers=headers, timeout=60.0)
            response.raise_for_status()
            return {"result": response.json().get("result", "")}
        except httpx.HTTPStatusError as e:
            return {
                "error": True,
                "message": "API Not Active",
                "detail": f"Status {e.response.status_code}: {e.response.text}"
            }
        except httpx.RequestError as e:
            return {
                "error": True,
                "message": "API Not Active",
                "detail": f"Connection error: {e}"
            }


def _build_bpmn_prompt(data: dict) -> str:
    """Structure the BPMN generation prompt to keep responses concise and XML-only."""
    return (
        "You are a expert BPMN 2.0 assistant. "
        "Generate a Signavio-compatible BPMN 2.0 XML. for my following process"
        f"Process Name: {data.get('processName', '')}\n"
        f"Pool: {data.get('poolName', '')}\n"
        f"Participants (lanes): {data.get('participants', '')}\n"
        f"Sublanes: {data.get('subLanes', '')}\n"
        f"Start Triggers: {data.get('startTriggers', '')}\n"
        f"Activities and Process Steps: {data.get('processActivities', '')}\n"
        f"End State: {data.get('processEnding', '')}\n"
        f"Intermediate/Delays: {data.get('intermediateEvents', '')}\n"
        f"Overrides/Notes: {data.get('reviewOverride', '')}\n"
    )

#Main Function to get the BPMN file!

async def get_signavio_bpmn_xml(data: dict):
    prompt = _build_bpmn_prompt(data) + " Give the BPMN/XML Code"
    brain_id = os.getenv("SIGNAVIO_BRAIN_ID")
    response = await call_brain_chat(brain_id, prompt, use_gpt_knowledge=False)

    if response.get("error"):
        return response

    raw_text = response.get("result", "")
    print("\n" + "="*50)
    print("DEBUG: RAW BRAIN RESPONSE")
    print("="*50)
    print(raw_text)
    print("="*50 + "\n")
    extracted_xml = _extract_xml(raw_text)

    if "<bpmn" not in extracted_xml.lower():
        return {
            "error": True,
            "message": "Invalid BPMN response",
            "detail": "Brain response did not contain BPMN XML."
        }

    return {"result": extracted_xml}