import os
import json
import re
from typing import Dict, Any, Optional
from services.agent.models.base import BaseModel

class GeminiModel(BaseModel):
    """
    Cloud model adapter using Gemini.
    STRICT PRIVACY CONSTRAINT:
    Only allowed when session.routing == 'CLOUD_ALLOWED'.
    Must never be called for 'LOCAL_ONLY' or 'BLOCK' sessions.
    """

    def __init__(self, model_name: str = "gemini-3.5-flash-lite"):
        self.model_name = model_name
        self.api_key = os.getenv("GEMINI_API_KEY")

    def plan(self, goal: str, context: str, tools: Dict[str, Any], session: Any) -> Dict[str, Any]:
        if session.routing != "CLOUD_ALLOWED":
            raise PermissionError(
                f"Privacy Violation: Gemini cloud model requested for session with routing '{session.routing}'. "
                "Only LOCAL_ONLY execution is permitted."
            )

        if not self.api_key:
            raise RuntimeError("GEMINI_API_KEY is not configured.")

        import google.generativeai as genai
        genai.configure(api_key=self.api_key)

        tool_descriptions = "\n".join([
            f"- {name}: {t['description']}"
            for name, t in tools.items()
        ])

        system_instruction = (
            "You are Mailmate's autonomous preparatory work agent runtime.\n"
            "You operate in a bounded loop: PLAN -> POLICY -> ACT -> OBSERVE -> VERIFY.\n"
            "Your goal is to prepare all required outputs (checklist, drafted reply, workspace files) for the user's review.\n"
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
            f"AVAILABLE TOOLS:\n{tool_descriptions}\n\n"
            f"CURRENT CONTEXT & STATE:\n{context}\n\n"
            "Choose the single next best action to advance this goal. Return valid JSON only."
        )

        model = genai.GenerativeModel(
            self.model_name,
            system_instruction=system_instruction,
            generation_config={"response_mime_type": "application/json", "temperature": 0.1}
        )

        res = model.generate_content(user_prompt, request_options={"timeout": 10})
        content = res.text
        clean = re.sub(r"^```(?:json)?\s*|\s*```$", "", content.strip(), flags=re.I)
        return json.loads(clean)
