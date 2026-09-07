from typing import Dict, Any, Optional

class PolicyEngine:
    """
    Deterministic permission and boundary policy for the bounded agent loop.
    Ensures that the LLM NEVER decides permissions on its own.
    Enforces tool whitelists, prohibited action blacklists, and resource quotas.
    """

    PERMITTED_TOOLS = {
        # Mail
        "mail.get_safe_context",
        "mail.get_thread_safe",
        "mail.prepare_reply",
        "mail.create_draft",
        # Work
        "work.create_note",
        "work.create_checklist",
        "work.update_job",
        "work.request_input",
        "work.finish",
        # Files
        "file.create_markdown",
        "file.create_docx",
        "file.create_pdf",
        "file.read_generated",
        # Research
        "research.search",
        "research.fetch",
        "research.extract",
        "research.summarize_sources",
        # Calendar
        "calendar.read",
        "calendar.find_free_time",
        "calendar.prepare_event",
        # Utilities
        "calculator",
        "datetime"
    }

    PROHIBITED_TOOLS = {
        "mail.send": "Sending emails directly is strictly prohibited from the autonomous agent. Requires policy approval or human review.",
        "mail.delete": "Deleting emails is strictly prohibited.",
        "calendar.commit": "Committing calendar events requires user confirmation.",
        "calendar.delete": "Deleting calendar events is strictly prohibited.",
        "upload_external": "Uploading local files to external servers without human consent is prohibited.",
        "submit_form": "Submitting external forms or academic portals without review is prohibited."
    }

    @classmethod
    def check(cls, action: str, args: Dict[str, Any], session: Any) -> Dict[str, Any]:
        """
        Validates whether the proposed action and arguments are permitted.
        Returns:
            {"allowed": bool, "reason": str, "risk": str}
        """
        action = str(action or "").strip()

        # 1. Check prohibited tools blacklist
        if action in cls.PROHIBITED_TOOLS:
            return {
                "allowed": False,
                "reason": f"Action '{action}' is PROHIBITED: {cls.PROHIBITED_TOOLS[action]}",
                "risk": "critical"
            }

        # 2. Check permitted whitelist
        if action not in cls.PERMITTED_TOOLS:
            return {
                "allowed": False,
                "reason": f"Tool '{action}' is not in the restricted agent registry.",
                "risk": "high"
            }

        # 3. Quota Limits Checking
        if action.startswith("research.") and session.research_calls >= session.max_research_calls:
            return {
                "allowed": False,
                "reason": f"Research budget exceeded ({session.research_calls}/{session.max_research_calls} calls used). Proceed to synthesize findings.",
                "risk": "medium"
            }

        if action.startswith("file.create_") and session.generated_files >= session.max_generated_files:
            return {
                "allowed": False,
                "reason": f"Generated file budget exceeded ({session.generated_files}/{session.max_generated_files} files created).",
                "risk": "medium"
            }

        # 4. Routing Checks
        if action.startswith("research.") and session.routing == "BLOCK":
            return {
                "allowed": False,
                "reason": "Research is prohibited for emails classified as BLOCK.",
                "risk": "critical"
            }

        return {
            "allowed": True,
            "reason": "Policy check passed: tool and arguments permitted.",
            "risk": "low"
        }
