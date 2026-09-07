import os
import json
import re
import requests
from typing import Dict, Any, Optional
from services.agent.models.base import BaseModel

class LMStudioModel(BaseModel):
    """
    Local model adapter for LM Studio.
    Supports reasoning models (e.g. Qwen-3.5, DeepSeek-R1) and extracts structured actions.
    """

    def __init__(self, base_url: Optional[str] = None, model: Optional[str] = None, timeout: int = 35):
        self.base_url = (base_url or os.getenv("LM_STUDIO_BASE_URL", "http://127.0.0.1:2806/v1")).rstrip("/")
        self.model = model or os.getenv("LM_STUDIO_MODEL", "qwen/qwen3.5-4b")
        self.timeout = timeout

    def plan(self, goal: str, context: str, tools: Dict[str, Any], session: Any) -> Dict[str, Any]:
        tool_descriptions = "\n".join([
            f"- {name}: {t['description']}"
            for name, t in tools.items()
        ])

        system_prompt = (
            "You are Mailmate's autonomous preparatory work agent runtime.\n"
            "You operate in a bounded loop: PLAN -> POLICY -> ACT -> OBSERVE -> VERIFY.\n"
            "Your goal is to prepare all required outputs (checklist, drafted reply, workspace files) for the user's review.\n"
            "You do NOT have permission to send emails or alter external calendars; only prepare them.\n\n"
            "Available tools:\n"
            f"{tool_descriptions}\n\n"
            "Response Schema strictly matching JSON:\n"
            "{\n"
            '  "thought": "Reason about current state and what specific tool to use next",\n'
            '  "action": "tool_name",\n'
            '  "args": { "param1": "value1" }\n'
            "}\n"
            "When all preparations are done, call 'work.finish' with summary in args."
        )

        user_prompt = (
            f"GOAL: {goal}\n\n"
            f"CURRENT CONTEXT & STATE:\n{context}\n\n"
            "Choose the single next best action to advance this goal. Return valid JSON only."
        )

        payload = {
            "model": self.model,
            "temperature": 0.1,
            "max_tokens": 2500,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt}
            ]
        }

        try:
            res = requests.post(f"{self.base_url}/chat/completions", json=payload, timeout=self.timeout)
            if not res.ok:
                raise RuntimeError(f"LM Studio returned status {res.status_code}: {res.text}")

            msg = res.json()["choices"][0]["message"]
            content = msg.get("content") or ""
            thought = msg.get("reasoning_content") or ""

            # 1. Try extracting JSON from content
            clean = re.sub(r"^```(?:json)?\s*|\s*```$", "", content.strip(), flags=re.I)
            match = re.search(r"\{[\s\S]*\}", clean)
            if match:
                try:
                    parsed = json.loads(match.group(0))
                    if "action" in parsed:
                        if "thought" not in parsed and thought:
                            parsed["thought"] = thought[:250]
                        return parsed
                except Exception:
                    pass

            # 2. Try extracting JSON from reasoning_content if content was empty or incomplete
            if thought:
                clean_thought = re.sub(r"^```(?:json)?\s*|\s*```$", "", thought, flags=re.I)
                # Find all JSON-like blocks in reasoning
                for m in re.finditer(r"\{[\s\S]*?\}", clean_thought):
                    try:
                        p = json.loads(m.group(0))
                        if "action" in p:
                            return p
                    except Exception:
                        pass

            raise ValueError("No structured action JSON found in model completion.")
        except Exception as e:
            raise e
