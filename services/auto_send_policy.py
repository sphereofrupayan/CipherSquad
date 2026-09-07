import re

class AutoSendPolicy:
    """
    Deterministic safety policy engine for Mailmate Work Agent.
    
    Evaluates proposed reply drafts and context to decide whether an email can be
    safely sent via Autopilot or must be held for explicit human review.
    
    NEVER allows LLMs to send emails directly without passing this policy.
    """

    # Expressions that constitute commitments, promises, submissions, or deadlines
    COMMITMENT_PATTERNS = [
        r"\b(?:i will|i'll|will submit|will send|will finish|will complete|will have this|will deliver)\b",
        r"\b(?:promise|guarantee|assure you)\b",
        r"\b(?:by tomorrow|by tonight|by \d{1,2}(?::\d{2})?\s*(?:am|pm)?|within the next|in a few hours|in an hour)\b",
        r"\b(?:working on this and will|currently reviewing and will|currently working)\b",
        r"\b(?:submitting|submission|assignment|synopsis|report|presentation|draft attached)\b",
        r"\b(?:i agree to|we agree to|agreed to submit)\b",
    ]

    # Expressions related to meetings or appointments without verified calendar sync
    MEETING_PATTERNS = [
        r"\b(?:let's meet|meeting at|rescheduled to|call me at|see you at|hop on a call|zoom link|google meet)\b",
        r"\b(?:free at|available at \d|how about \d|does \d work for you)\b",
    ]

    # Sensitive or financial terms
    SENSITIVE_PATTERNS = [
        r"\b(?:invoice|payment|dollars?|rs\.?|inr|usd|\$|€|£|bank|account number|routing|swift|wire transfer)\b",
        r"\b(?:password|credential|secret|confidential|nda|social security|pan card|aadhaar)\b",
    ]

    # Uncertain claims
    UNCERTAIN_PATTERNS = [
        r"\b(?:i think|probably|maybe|might be able|not sure|uncertain|possibly|assuming|hopefully)\b",
    ]

    # Submissions / External actions
    SUBMISSION_PATTERNS = [
        r"\b(?:submitting|submission|submitted|submits|uploading|uploaded|form submitted)\b",
    ]

    # Safe acknowledgement patterns (must be short and purely confirmatory)
    SAFE_ACKNOWLEDGEMENT_PATTERNS = [
        r"^(?:hi|hello|hey)?[\s,]*(?:thanks|thank you|thanks a lot)[\s!.]*$",
        r"^(?:hi|hello|hey)?[\s,]*(?:thanks|thank you)[,\s]+(?:received|noted|got it)[\s!.]*$",
        r"^(?:hi|hello|hey)?[\s,]*(?:got it|received|noted|understood)[,\s]*(?:thanks|thank you)?[\s!.]*$",
        r"^(?:hi|hello|hey)?[\s,]*(?:yes|okay|ok)[,\s]+(?:i saw this|received|noted|got it)[\s!.]*$",
        r"^(?:hi|hello|hey)?[\s,]*(?:acknowledged|noted with thanks)[\s!.]*$",
        r"^(?:hi|hello|hey)?[\s,]*(?:thank you for (?:the update|confirming|letting me know))[\s!.]*$",
    ]

    @classmethod
    def evaluate(cls, reply_body: str, artifacts: list = None, source: dict = None, settings: dict = None) -> dict:
        """
        Evaluate reply text and context against safety policy.
        
        Returns:
            dict with:
                - auto_send_allowed (bool)
                - risk ("low" | "medium" | "high")
                - category ("safe_acknowledgement" | "commitment_detected" | "attachments_present" | etc.)
                - explanation (str)
                - flags (list of str)
        """
        artifacts = artifacts or []
        source = source or {}
        settings = settings or {}

        auto_send_mode = settings.get("auto_send_mode", "safe_replies")  # "off", "prepare", "safe_replies", "full_prepare"
        # Backwards compatibility
        if auto_send_mode in ["never", "safe_only"]:
            auto_send_mode = "prepare" if auto_send_mode == "never" else "safe_replies"

        trusted_senders = [s.lower().strip() for s in settings.get("trusted_senders", [])]

        clean_body = re.sub(r"\s+", " ", str(reply_body or "")).strip()
        flags = []
        explanation_reasons = []

        # 1. Global autonomy level checks
        if auto_send_mode == "off":
            return {
                "auto_send_allowed": False,
                "risk": "low",
                "category": "autopilot_off",
                "explanation": "Autopilot is turned off. Acts only when directly requested by user.",
                "flags": ["mode_off"]
            }

        if auto_send_mode == "prepare":
            return {
                "auto_send_allowed": False,
                "risk": "low",
                "category": "prepare_only",
                "explanation": "Autopilot is in prepare-only mode. Automatic sending disabled.",
                "flags": ["mode_prepare_only"]
            }

        # 2. Only files that are actually intended to leave Mailmate count
        # as outbound attachments. Internal workspace notes/checklists and
        # the Gmail draft object itself must not block a safe acknowledgement.
        outbound_artifacts = [
            artifact for artifact in artifacts
            if artifact.get("attach_to_reply") is True
            or artifact.get("external_delivery") is True
        ]
        if outbound_artifacts:
            flags.append("workspace_files")
            file_names = [a.get("name", "file") for a in outbound_artifacts]
            explanation_reasons.append(
                f"Generated files intended for external delivery ({', '.join(file_names[:2])})"
            )

        # 3. Check for substantive commitments or promises
        for pattern in cls.COMMITMENT_PATTERNS:
            match = re.search(pattern, clean_body, re.I)
            if match:
                flags.append("commitment")
                explanation_reasons.append(f"Contains commitment: \"{match.group(0)}\"")
                break

        # 4. Check for meeting / schedule commitments
        for pattern in cls.MEETING_PATTERNS:
            match = re.search(pattern, clean_body, re.I)
            if match:
                flags.append("meeting_commitment")
                explanation_reasons.append(f"Contains meeting commitment: \"{match.group(0)}\"")
                break

        # 5. Check for sensitive or financial terms
        for pattern in cls.SENSITIVE_PATTERNS:
            match = re.search(pattern, clean_body, re.I)
            if match:
                flags.append("sensitive_terms")
                explanation_reasons.append(f"Contains sensitive or financial term: \"{match.group(0)}\"")
                break

        # 6. Check for submissions or external uploads
        for pattern in cls.SUBMISSION_PATTERNS:
            match = re.search(pattern, clean_body, re.I)
            if match:
                flags.append("submission_content")
                explanation_reasons.append(f"Contains submission / upload reference: \"{match.group(0)}\"")
                break

        # 7. Check for uncertain claims
        for pattern in cls.UNCERTAIN_PATTERNS:
            match = re.search(pattern, clean_body, re.I)
            if match:
                flags.append("uncertain_claim")
                explanation_reasons.append(f"Contains uncertain claim: \"{match.group(0)}\"")
                break

        # 8. Check recipient count (must be single recipient only)
        to_list = source.get("to") or []
        cc_list = source.get("cc") or []
        if (isinstance(to_list, list) and len(to_list) > 1) or (isinstance(cc_list, list) and len(cc_list) > 0):
            flags.append("multiple_recipients")
            explanation_reasons.append("Thread has multiple recipients or CC")

        # If any risk flags exist, reject auto-send immediately
        if flags:
            return {
                "auto_send_allowed": False,
                "risk": "high" if any(f in ["commitment", "workspace_files", "sensitive_terms", "submission_content"] for f in flags) else "medium",
                "category": flags[0],
                "explanation": "; ".join(explanation_reasons),
                "flags": flags
            }

        # 7. Check if reply is a pure safe acknowledgement
        body_without_signoff = re.sub(r"(?:regards|best|sincerely|thanks,?)\s*\w+$", "", clean_body, flags=re.I).strip()
        is_acknowledgement = False
        for pat in cls.SAFE_ACKNOWLEDGEMENT_PATTERNS:
            if re.search(pat, body_without_signoff, re.I) or re.search(pat, clean_body, re.I):
                is_acknowledgement = True
                break

        # If body is very short and strictly confirmatory (<= 120 chars)
        if not is_acknowledgement and len(clean_body) <= 120:
            if re.search(r"\b(thanks|thank you|got it|noted|received)\b", clean_body, re.I) and not re.search(r"\b(will|when|what|why|where|how|please|could)\b", clean_body, re.I):
                is_acknowledgement = True

        if is_acknowledgement:
            sender_raw = str(source.get("sender") or "").lower()
            sender_email_match = re.search(r"[\w\.-]+@[\w\.-]+", sender_raw)
            sender_email = sender_email_match.group(0) if sender_email_match else sender_raw

            if auto_send_mode == "trusted_only":
                if sender_email in trusted_senders or any(domain in sender_email for domain in ["@google.com", "@apple.com", "@gmail.com"]):
                    return {
                        "auto_send_allowed": True,
                        "risk": "low",
                        "category": "safe_acknowledgement",
                        "explanation": "Safe acknowledgement to trusted contact. Low risk · No commitment · No attachment.",
                        "flags": ["safe_acknowledgement", "trusted_sender"]
                    }
                else:
                    return {
                        "auto_send_allowed": False,
                        "risk": "low",
                        "category": "untrusted_sender",
                        "explanation": f"Safe acknowledgement, but sender ({sender_email}) is not in trusted contacts.",
                        "flags": ["safe_acknowledgement", "not_in_trusted"]
                    }

            # Safe only mode allows safe acknowledgements
            return {
                "auto_send_allowed": True,
                "risk": "low",
                "category": "safe_acknowledgement",
                "explanation": "Low risk · Simple acknowledgement · No attachment · No commitment · Known sender",
                "flags": ["safe_acknowledgement"]
            }

        # Substantive reply without explicit commitment, but needs human eyes
        return {
            "auto_send_allowed": False,
            "risk": "medium",
            "category": "substantive_reply",
            "explanation": "Substantive reply requires human review before dispatch.",
            "flags": ["substantive_content"]
        }
