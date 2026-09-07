import os
import re
from pathlib import Path
from typing import Dict, Any, List, Tuple, Optional

BASE_DIR = Path(__file__).resolve().parent.parent.parent
WORKSPACES_DIR = BASE_DIR / "workspaces"

class Verifier:
    """
    Deterministic verifier for agent steps and final outputs.
    Enforces self-correction feedback loops during execution:
      - Checks file existence, non-emptiness, and section completeness.
      - Flags phantom attachment claims in email drafts.
      - Validates research source depth.
    """

    ATTACHMENT_CLAIM_PATTERNS = [
        r"\b(?:attached|attachment|enclosed|see attached|find attached|checklist attached|report attached)\b",
        r"\b(?:i have attached|i've attached|please find attached)\b"
    ]

    @classmethod
    def verify_step(
        cls,
        action: str,
        args: Dict[str, Any],
        observation: Dict[str, Any],
        session: Any
    ) -> Tuple[bool, Optional[str]]:
        """
        Intermediate verification after each tool action.
        Returns:
            (is_valid, repair_observation_hint)
        """
        # 1. File creation verification
        if action.startswith("file.create_"):
            if not observation.get("ok"):
                return False, f"File creation failed: {observation.get('error')}. Please retry with valid specification."

            filename = args.get("filename") or observation.get("name")
            spec = args.get("spec") or {}
            ws_dir = WORKSPACES_DIR / session.job_id
            fpath = ws_dir / filename

            if not fpath.exists():
                return False, f"Verification failed: Artifact '{filename}' was not created on disk. Repair file creation."

            if fpath.stat().st_size == 0:
                return False, f"Verification failed: Artifact '{filename}' is empty (0 bytes). Repair with substantive content."

            # Check for section structure in multi-section documents
            if isinstance(spec, dict):
                sections = spec.get("sections") or []
                if not sections and "content" not in spec:
                    return False, "Verification notice: Document specification has no sections. Add substantive sections."

            return True, None

        # 2. Draft attachment consistency check
        if action in ["mail.prepare_reply", "mail.create_draft"]:
            body = str(args.get("body") or "")
            claims_attachment = any(re.search(pat, body, re.I) for pat in cls.ATTACHMENT_CLAIM_PATTERNS)

            # Look for generated files in session (excluding email_draft itself)
            file_artifacts = [a for a in session.artifacts if a.get("type") == "file"]

            if claims_attachment and len(file_artifacts) == 0:
                return False, (
                    "Verification failed (Claim Mismatch): The draft states that an attachment is included, "
                    "but no workspace file has been generated yet. Create the requested artifact (.md, .docx, or .pdf) "
                    "or update the draft to remove the attachment claim."
                )

            return True, None

        # 3. Research depth check
        if action == "research.search":
            results = observation.get("results") or []
            if len(results) == 0:
                return False, "Verification notice: Search returned 0 sources. Broaden or refine the technical query."
            return True, None

        return True, None

    @classmethod
    def goal_satisfied(cls, session: Any) -> bool:
        """
        Evaluates whether the primary goals of the Work task have been met:
          - A draft reply is prepared
          - A checklist or note exists
          - If academic/full_prepare, at least one file artifact exists
        """
        has_reply = bool(session.reply_draft.get("body"))
        has_plan = bool(session.checklist or session.notes)

        subj = f"{session.source_email.get('subject', '')} {session.source_email.get('snippet', '')}".lower()
        needs_pdf = bool(re.search(r"\bpdf\b", subj))

        file_artifacts = [a for a in session.artifacts if a.get("type") == "file"]

        if needs_pdf:
            has_pdf = any(a.get("name", "").lower().endswith(".pdf") for a in file_artifacts)
            if not has_pdf:
                return False
            return has_reply and has_pdf

        is_academic = bool(re.search(
            r"\b(da|assignment|submission|exam|synopsis|report|project)\b",
            subj,
            re.I
        ))

        if is_academic:
            return has_reply and has_plan and len(file_artifacts) >= 1
        return has_reply and has_plan

    @classmethod
    def finalize(cls, session: Any) -> Dict[str, Any]:
        """
        Runs exhaustive final audit and constructs structured verification report.
        """
        checks = []
        overall_passed = True

        # Check 0: Requested Deliverable Type Match
        subj = f"{session.source_email.get('subject', '')} {session.source_email.get('snippet', '')}".lower()
        needs_pdf = bool(re.search(r"\bpdf\b", subj))
        file_artifacts = [a for a in session.artifacts if a.get("type") == "file"]
        if needs_pdf:
            has_pdf = any(a.get("name", "").lower().endswith(".pdf") for a in file_artifacts)
            if not has_pdf:
                checks.append({
                    "name": "Requested Deliverable Present",
                    "passed": False,
                    "detail": "Email explicitly requested a PDF, but no PDF artifact was produced."
                })
                overall_passed = False
                if not session.missing_deliverable:
                    session.missing_deliverable = "PDF"
            else:
                checks.append({
                    "name": "Requested Deliverable Present",
                    "passed": True,
                    "detail": "Requested PDF artifact verified on disk."
                })

        # Check 1: Reply Draft
        body = session.reply_draft.get("body") or ""
        if body:
            checks.append({
                "name": "Draft Reply Prepared",
                "passed": True,
                "detail": f"Draft prepared ({len(body)} chars)."
            })
        else:
            checks.append({
                "name": "Draft Reply Prepared",
                "passed": False,
                "detail": "No reply draft was generated."
            })
            overall_passed = False

        # Check 2: Attachment & Completion Claim Consistency
        claims_attachment = any(re.search(pat, body, re.I) for pat in cls.ATTACHMENT_CLAIM_PATTERNS)
        claims_completion = bool(re.search(r"\b(i have completed|have completed|already submitted|is attached)\b", body, re.I))
        if claims_attachment and len(file_artifacts) == 0:
            checks.append({
                "name": "Claim Alignment",
                "passed": False,
                "detail": "Draft claims attachment is included, but no workspace file exists."
            })
            overall_passed = False
        elif claims_completion and (needs_pdf and not any(a.get("name", "").lower().endswith(".pdf") for a in file_artifacts)):
            checks.append({
                "name": "Claim Alignment",
                "passed": False,
                "detail": "Draft claims completion, but required deliverable is missing."
            })
            overall_passed = False
        else:
            checks.append({
                "name": "Claim Alignment",
                "passed": True,
                "detail": f"Claims verified ({len(file_artifacts)} files match)." if claims_attachment else "No unverified claims made."
            })

        # Check 3: File Artifact Integrity
        ws_dir = WORKSPACES_DIR / session.job_id
        for a in file_artifacts:
            fname = a.get("name")
            fpath = ws_dir / fname
            exists = fpath.exists()
            size = fpath.stat().st_size if exists else 0
            if exists and size > 0:
                checks.append({
                    "name": f"Artifact Integrity ({fname})",
                    "passed": True,
                    "detail": f"File exists ({size} bytes)."
                })
            else:
                checks.append({
                    "name": f"Artifact Integrity ({fname})",
                    "passed": False,
                    "detail": "File missing or 0 bytes."
                })
                overall_passed = False

        # Check 4: Checklist & Planning
        if session.checklist:
            checks.append({
                "name": "Actionable Checklist",
                "passed": True,
                "detail": f"{len(session.checklist)} actionable steps defined."
            })
        else:
            checks.append({
                "name": "Actionable Checklist",
                "passed": False,
                "detail": "No checklist items registered."
            })

        report = {
            "passed": overall_passed,
            "checks": checks,
            "verified_at": session.job_id
        }
        session.verification_report = report
        return report
