import datetime
import math
import traceback
from typing import Dict, Any, Callable, Optional
from services.agent.observation import ObservationNormalizer
from services.agent.tools import mail, files, research, calendar, work

class ToolRegistry:
    """Restricted tool registry mapping permitted tool names to Python handlers."""

    def __init__(self):
        self._handlers: Dict[str, Callable] = {}
        self._schemas: Dict[str, Dict[str, Any]] = {}
        self._register_defaults()

    def register(self, name: str, handler: Callable, description: str, parameters: Dict[str, Any]):
        self._handlers[name] = handler
        self._schemas[name] = {
            "name": name,
            "description": description,
            "parameters": parameters
        }

    def _register_defaults(self):
        # Mail
        self.register(
            "mail.get_safe_context",
            lambda session, **kwargs: mail.get_safe_context(session),
            "Get privacy-evaluated safe email context (sender, subject, deadline, snippet).",
            {"type": "object", "properties": {}}
        )
        self.register(
            "mail.get_thread_safe",
            lambda session, thread_id="", **kwargs: mail.get_thread_safe(thread_id, session),
            "Get thread messages filtered through the local privacy gate.",
            {"type": "object", "properties": {"thread_id": {"type": "string"}}}
        )
        self.register(
            "mail.prepare_reply",
            lambda session, body, subject="", to="", **kwargs: mail.prepare_reply(body, subject, to, session),
            "Stage a drafted reply for review without dispatching.",
            {"type": "object", "properties": {"body": {"type": "string"}, "subject": {"type": "string"}, "to": {"type": "string"}}, "required": ["body"]}
        )
        self.register(
            "mail.create_draft",
            lambda session, body, subject="", to="", **kwargs: mail.create_draft(body, subject, to, session),
            "Create or synchronize a real Gmail draft via Google Workspace API (NEVER sends).",
            {"type": "object", "properties": {"body": {"type": "string"}, "subject": {"type": "string"}, "to": {"type": "string"}}, "required": ["body"]}
        )

        # Work
        self.register(
            "work.create_note",
            lambda session, note, **kwargs: work.create_note(note, session),
            "Record an important requirement or key note on this task.",
            {"type": "object", "properties": {"note": {"type": "string"}}, "required": ["note"]}
        )
        self.register(
            "work.create_checklist",
            lambda session, items, **kwargs: work.create_checklist(items, session),
            "Register actionable step-by-step checklist items for this task.",
            {"type": "object", "properties": {"items": {"type": "array", "items": {"type": "string"}}}, "required": ["items"]}
        )
        self.register(
            "work.update_job",
            lambda session, summary, **kwargs: work.update_job(summary, session),
            "Update the high-level summary of work prepared.",
            {"type": "object", "properties": {"summary": {"type": "string"}}, "required": ["summary"]}
        )
        self.register(
            "work.request_input",
            lambda session, question, reason="", **kwargs: work.request_input(question, reason, session),
            "Request clarifying guidance from the user if instructions are ambiguous.",
            {"type": "object", "properties": {"question": {"type": "string"}, "reason": {"type": "string"}}, "required": ["question"]}
        )
        self.register(
            "work.finish",
            lambda session, summary="", **kwargs: work.finish(summary, session),
            "Signal that all preparations (draft, checklist, files) are completed.",
            {"type": "object", "properties": {"summary": {"type": "string"}}}
        )

        # Files
        self.register(
            "file.create_markdown",
            lambda session, filename, spec, **kwargs: files.create_markdown(session.job_id, filename, spec),
            "Render a structured document specification into a clean .md Markdown file.",
            {"type": "object", "properties": {"filename": {"type": "string"}, "spec": {"type": "object"}}, "required": ["filename", "spec"]}
        )
        self.register(
            "file.create_docx",
            lambda session, filename, spec, **kwargs: files.create_docx(session.job_id, filename, spec),
            "Render a structured document specification into a Microsoft Word .docx file.",
            {"type": "object", "properties": {"filename": {"type": "string"}, "spec": {"type": "object"}}, "required": ["filename", "spec"]}
        )
        self.register(
            "file.create_pdf",
            lambda session, filename, spec, **kwargs: files.create_pdf(session.job_id, filename, spec),
            "Render a structured document specification into a styled .pdf document.",
            {"type": "object", "properties": {"filename": {"type": "string"}, "spec": {"type": "object"}}, "required": ["filename", "spec"]}
        )
        self.register(
            "file.read_generated",
            lambda session, filename, **kwargs: files.read_generated(session.job_id, filename),
            "Read a previously generated workspace file to verify its contents.",
            {"type": "object", "properties": {"filename": {"type": "string"}}, "required": ["filename"]}
        )

        # Research
        self.register(
            "research.search",
            lambda session, query, num_results=3, **kwargs: research.search(query, session, num_results),
            "Search reference sources (query is strictly sanitized before leaving local system).",
            {"type": "object", "properties": {"query": {"type": "string"}, "num_results": {"type": "integer"}}, "required": ["query"]}
        )
        self.register(
            "research.fetch",
            lambda session, title, **kwargs: research.fetch(title),
            "Fetch the full summary/extract of a reference article.",
            {"type": "object", "properties": {"title": {"type": "string"}}, "required": ["title"]}
        )
        self.register(
            "research.extract",
            lambda session, text, target_topic="", **kwargs: research.extract(text, target_topic),
            "Extract key technical takeaways and concepts from text.",
            {"type": "object", "properties": {"text": {"type": "string"}, "target_topic": {"type": "string"}}, "required": ["text"]}
        )
        self.register(
            "research.summarize_sources",
            lambda session, sources, **kwargs: research.summarize_sources(sources),
            "Build citation and reference list from sources.",
            {"type": "object", "properties": {"sources": {"type": "array"}}, "required": ["sources"]}
        )

        # Calendar
        self.register(
            "calendar.read",
            lambda session, date="", days=3, **kwargs: calendar.read(date, days, session),
            "Read user calendar events to check scheduling constraints.",
            {"type": "object", "properties": {"date": {"type": "string"}, "days": {"type": "integer"}}}
        )
        self.register(
            "calendar.find_free_time",
            lambda session, date="", duration_minutes=30, **kwargs: calendar.find_free_time(date, duration_minutes, session),
            "Discover open time slots in user schedule.",
            {"type": "object", "properties": {"date": {"type": "string"}, "duration_minutes": {"type": "integer"}}}
        )
        self.register(
            "calendar.prepare_event",
            lambda session, title, start_time, end_time, description="", **kwargs: calendar.prepare_event(title, start_time, end_time, description, session),
            "Prepare a proposed calendar event (waits for human review; does NOT commit).",
            {"type": "object", "properties": {"title": {"type": "string"}, "start_time": {"type": "string"}, "end_time": {"type": "string"}}, "required": ["title", "start_time", "end_time"]}
        )

        # Utility
        self.register(
            "calculator",
            lambda session, expression, **kwargs: {"ok": True, "result": eval(expression, {"__builtins__": {}}, {"math": math})},
            "Evaluate a simple mathematical expression safely.",
            {"type": "object", "properties": {"expression": {"type": "string"}}, "required": ["expression"]}
        )
        self.register(
            "datetime",
            lambda session, **kwargs: {"ok": True, "utc_now": datetime.datetime.now(datetime.timezone.utc).isoformat()},
            "Get the current UTC timestamp.",
            {"type": "object", "properties": {}}
        )

    def schemas(self) -> Dict[str, Any]:
        return dict(self._schemas)

    def execute(self, action: str, args: Dict[str, Any], session: Any) -> Dict[str, Any]:
        handler = self._handlers.get(action)
        if not handler:
            return ObservationNormalizer.normalize(None, error=f"Tool '{action}' not found in registry.")

        try:
            res = handler(session=session, **(args or {}))
            # Also auto-register generated files as session artifacts
            if isinstance(res, dict) and res.get("ok") and action.startswith("file.create_"):
                session.add_artifact(res)
            return ObservationNormalizer.normalize(res)
        except Exception as e:
            return ObservationNormalizer.normalize(None, error=f"Tool execution failed: {e}")
