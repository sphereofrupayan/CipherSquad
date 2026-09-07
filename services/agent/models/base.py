from typing import Dict, Any

class BaseModel:
    """Abstract interface for LLM planner in the bounded agent harness."""

    def plan(self, goal: str, context: str, tools: Dict[str, Any], session: Any) -> Dict[str, Any]:
        """
        Given the goal, compact context, available tools, and session,
        decides the next step.
        Returns:
            {
                "thought": str,
                "action": str,
                "args": dict
            }
        """
        raise NotImplementedError
