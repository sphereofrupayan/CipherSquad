import re
from typing import Dict, Any, List, Optional, Tuple

class PrivacyGate:
    """
    Two-Plane Deterministic Privacy Gate.
    
    Enforces the architectural separation between:
    1. DISPLAY PLANE: User-authorized Gmail content is displayed transiently
       in browser RAM. The gate NEVER hides emails from the human user.
    2. AI / WORK PLANE: Before any email reaches Gemini, LM Studio, Kyle,
       or the Work Agent, this deterministic gate evaluates sensitivity
       and passes ONLY required, safe, and actionable context.
    
    Rule Hierarchy:
    - Financial & Sensitive -> ai_allowed: False, work_agent_allowed: False
    - Security / Auth / OTP -> ai_allowed: False, work_agent_allowed: False
    - Health / Legal / ID   -> ai_allowed: False, work_agent_allowed: False
    - Marketing / Automated -> ai_allowed: False, work_agent_allowed: False
    - Academic / Assignment -> ai_allowed: True,  work_agent_allowed: True, store_derived_state: True
    - Actionable Project    -> ai_allowed: True,  work_agent_allowed: True, store_derived_state: True
    - Direct Correspondence -> ai_allowed: True,  work_agent_allowed: False
    """

    # 1. Financial & Banking
    FINANCIAL_SENDERS = [
        r"@(?:[a-z0-9.-]+\.)?(?:hdfcbank|icicibank|sbi|axisbank|kotak|citibank|chase|bankofamerica|wellsfargo|hsbc|barclays|paypal|stripe|razorpay|paytm|phonepe|cred)\.",
        r"(?:alerts?|notify|banking|statements?|cards?)@"
    ]
    FINANCIAL_KEYWORDS = [
        r"\btransaction alert\b",
        r"\b(?:debited|credited)\s+(?:by|with|for|inr|rs\.?|\$)",
        r"\baccount balance\b",
        r"\b(?:bank|credit card|account)\s+statement\b",
        r"\bcard ending in \d{4}\b",
        r"\b(?:upi|neft|rtgs|imps)\s+(?:ref|reference|transaction)\b",
        r"\binward remittance\b",
        r"\boutward remittance\b",
        r"\binvoice (?:attached|enclosed|due|payment)\b",
        r"\bsalary (?:slip|credited)\b",
        r"\bloan account\b",
        r"\b(?:tax return|itr|form 16)\b",
        r"\bpayment (?:received|successful|failed|declined)\b"
    ]

    # 2. Security, Auth, OTP
    SECURITY_SENDERS = [
        r"(?:security|auth|verify|verification|account-security|no-reply@accounts\.google\.com|noreply@.*apple\.com)",
        r"(?:id-verify|2fa|mfa|login-alerts?)@"
    ]
    SECURITY_KEYWORDS = [
        r"\b(?:one[- ]time password|otp)\b",
        r"\bverification code (?:is|:)\s*\d+",
        r"\b(?:security|passcode|temporary) code\b",
        r"\btwo[- ]factor authentication\b",
        r"\breset (?:your )?password\b",
        r"\bpassword reset\b",
        r"\bnew login (?:detected|from|alert)\b",
        r"\bunrecognized device\b",
        r"\bconfirm your email\b",
        r"\bclick here to verify\b"
    ]

    # 3. Health, Medical & Legal
    HEALTH_LEGAL_KEYWORDS = [
        r"\bmedical (?:report|record|history)\b",
        r"\bdoctor(?:'s)? prescription\b",
        r"\blaboratory test results?\b",
        r"\bpathology report\b",
        r"\bdiagnostic report\b",
        r"\bhealth insurance (?:claim|policy)\b",
        r"\blegal notice\b",
        r"\bcourt summons\b",
        r"\bconfidential non-disclosure agreement\b"
    ]

    # 4. Marketing, Newsletters & Bulk Automated
    MARKETING_SENDERS = [
        r"^(?:no-?reply|donotreply|mailer-daemon|notifications?|promotions?|newsletter|updates?|news)@",
        r"@(?:marketing|promo|mail\.|bounce\.|em\.|news\.)"
    ]
    MARKETING_KEYWORDS = [
        r"\bunsubscribe\b",
        r"\bview in (?:browser|web)\b",
        r"\bspecial offer\b",
        r"\bexclusive discount\b",
        r"\bsale ends (?:soon|today|tonight)\b",
        r"\bprivacy policy update\b",
        r"\bterms of service update\b",
        r"\bweekly digest\b",
        r"\bdaily digest\b",
        r"\btrending on reddit\b"
    ]

    # 5. Actionable Academic / Coursework
    ACADEMIC_KEYWORDS = [
        r"\b(?:da|digital assignment|assignment)\s*(?:submission|due|deadline|\d+)?\b",
        r"\b(?:homework|lab report|project report|viva|quiz|exam|midterm|endsem)\b",
        r"\bsubmit(?:ted|ting)?\s+(?:before|within|by|on)\b",
        r"\bsubmission deadline\b",
        r"\bdue (?:tomorrow|today|on|before|in \d+ hours?)\b",
        r"\burgent submit\b",
        r"\b(?:course coordinator|professor|faculty|instructor|teaching assistant|ta)\b",
        r"\bcapstone project\b",
        r"\bcurriculum|syllabus\b"
    ]

    # 6. Actionable Work / Professional Tasks
    WORK_KEYWORDS = [
        r"\baction required\b",
        r"\bplease review and (?:approve|comment|submit)\b",
        r"\bplease review the attached\b",
        r"\bdeliverable due\b",
        r"\bdeadline for the (?:project|release|pr|proposal)\b",
        r"\btask assigned to you\b",
        r"\bfeedback requested\b",
        r"\bneeds your input\b"
    ]

    @classmethod
    def evaluate(cls, item: Dict[str, Any]) -> Dict[str, Any]:
        """
        Deterministically evaluates an email or thread item.
        Returns gate metadata governing visibility, AI access, and work agent eligibility.
        """
        sender = str(item.get("sender") or item.get("from") or "").lower()
        subject = str(item.get("subject") or "").lower()
        body = str(item.get("snippet") or item.get("body") or "").lower()
        text = f"{subject} {body}"

        # 1. Check Financial & Banking -> BLOCKED FROM AI
        for pat in cls.FINANCIAL_SENDERS:
            if re.search(pat, sender, re.I):
                return cls._decision(
                    visible_to_user=True,
                    ai_allowed=False,
                    work_agent_allowed=False,
                    store_derived_state=False,
                    category="financial_sensitive",
                    reason="Sender matches recognized banking or financial institution",
                    label="Financial Sensitive"
                )
        for pat in cls.FINANCIAL_KEYWORDS:
            if re.search(pat, text, re.I):
                return cls._decision(
                    visible_to_user=True,
                    ai_allowed=False,
                    work_agent_allowed=False,
                    store_derived_state=False,
                    category="financial_sensitive",
                    reason=f"Contains financial or transaction indicator",
                    label="Financial Sensitive"
                )

        # 2. Check Security, Auth & OTP -> BLOCKED FROM AI
        for pat in cls.SECURITY_SENDERS:
            if re.search(pat, sender, re.I):
                return cls._decision(
                    visible_to_user=True,
                    ai_allowed=False,
                    work_agent_allowed=False,
                    store_derived_state=False,
                    category="security_sensitive",
                    reason="Sender matches authentication or security notification service",
                    label="Security / OTP"
                )
        for pat in cls.SECURITY_KEYWORDS:
            if re.search(pat, text, re.I):
                return cls._decision(
                    visible_to_user=True,
                    ai_allowed=False,
                    work_agent_allowed=False,
                    store_derived_state=False,
                    category="security_sensitive",
                    reason="Contains one-time password or security verification code",
                    label="Security / OTP"
                )

        # 3. Check Health / Medical / Legal -> BLOCKED FROM AI
        for pat in cls.HEALTH_LEGAL_KEYWORDS:
            if re.search(pat, text, re.I):
                return cls._decision(
                    visible_to_user=True,
                    ai_allowed=False,
                    work_agent_allowed=False,
                    store_derived_state=False,
                    category="health_personal_sensitive",
                    reason="Contains confidential medical, legal, or personal identity information",
                    label="Medical / Legal"
                )

        # 4. Check Actionable Academic Tasks -> ALLOWED FOR AI & WORK AGENT
        for pat in cls.ACADEMIC_KEYWORDS:
            if re.search(pat, text, re.I):
                return cls._decision(
                    visible_to_user=True,
                    ai_allowed=True,
                    work_agent_allowed=True,
                    store_derived_state=True,
                    category="actionable_academic_task",
                    reason="Actionable coursework or academic submission task detected",
                    label="Academic Task"
                )

        # 5. Check Actionable Professional Work -> ALLOWED FOR AI & WORK AGENT
        for pat in cls.WORK_KEYWORDS:
            if re.search(pat, text, re.I):
                return cls._decision(
                    visible_to_user=True,
                    ai_allowed=True,
                    work_agent_allowed=True,
                    store_derived_state=True,
                    category="actionable_work_task",
                    reason="Actionable professional or project deliverable detected",
                    label="Work Task"
                )

        # 6. Check Marketing, Newsletters & Bulk -> BLOCKED FROM AI
        for pat in cls.MARKETING_SENDERS:
            if re.search(pat, sender, re.I):
                return cls._decision(
                    visible_to_user=True,
                    ai_allowed=False,
                    work_agent_allowed=False,
                    store_derived_state=False,
                    category="automated_promotional",
                    reason="Automated notification or promotional sender",
                    label="Marketing / Bulk"
                )
        for pat in cls.MARKETING_KEYWORDS:
            if re.search(pat, text, re.I):
                return cls._decision(
                    visible_to_user=True,
                    ai_allowed=False,
                    work_agent_allowed=False,
                    store_derived_state=False,
                    category="automated_promotional",
                    reason="Contains newsletter, marketing, or promotional unsubscribe text",
                    label="Marketing / Bulk"
                )

        # 7. Default Direct Human Email / General Conversation -> AI ALLOWED, LOCAL ONLY
        return cls._decision(
            visible_to_user=True,
            ai_allowed=True,
            work_agent_allowed=False,
            store_derived_state=False,
            category="personal_correspondence",
            reason="Direct communication; suitable for contextual summarization",
            label="Direct Email",
            routing="LOCAL_ONLY"
        )

    @classmethod
    def _decision(
        cls,
        visible_to_user: bool,
        ai_allowed: bool,
        work_agent_allowed: bool,
        store_derived_state: bool,
        category: str,
        reason: str,
        label: str,
        routing: Optional[str] = None
    ) -> Dict[str, Any]:
        if routing is None:
            if not ai_allowed:
                routing = "BLOCK"
            elif category in ["personal_correspondence"]:
                routing = "LOCAL_ONLY"
            else:
                routing = "CLOUD_ALLOWED"

        return {
            "visible_to_user": visible_to_user,
            "ai_allowed": ai_allowed,
            "work_agent_allowed": work_agent_allowed,
            "store_derived_state": store_derived_state,
            "category": category,
            "reason": reason,
            "label": label,
            "routing": routing,  # "BLOCK" | "LOCAL_ONLY" | "CLOUD_ALLOWED"
            "ai": "ALLOW" if ai_allowed else "BLOCK"
        }

    @classmethod
    def sanitize_research_query(cls, query: str, context: Optional[Dict[str, Any]] = None) -> str:
        """
        Sanitizes external research queries before they leave the local system.
        Strips names, emails, addresses, message IDs, and mailbox context.
        
        Example:
            Input: "Priyam Trivedi VIT operating systems DA assigned by Rupayan. Prepare a report on Round Robin scheduling"
            Output: "Round Robin scheduling"
        """
        text = str(query or "").strip()
        if not text:
            return ""

        # 1. Remove email addresses and URLs
        text = re.sub(r"[\w\.-]+@[\w\.-]+", " ", text)
        text = re.sub(r"https?://\S+", " ", text)

        # 2. Remove message IDs and hex hashes
        text = re.sub(r"\b(?:work_|msg_|draft_)?[a-f0-9]{8,64}\b", " ", text, flags=re.I)
        text = re.sub(r"<[^>]+>", " ", text)

        # 3. Remove known context entities if provided (e.g. sender name, user name)
        if context:
            user_name = str(context.get("user_name") or "Priyam").strip()
            sender = str(context.get("sender") or "").strip()
            # Extract plain name from sender if format is "Name <email>"
            sender_name = re.sub(r"<.*?>", "", sender).strip()
            for entity in [user_name, sender_name, "Priyam", "Trivedi", "Rupayan"]:
                if entity and len(entity) > 2:
                    text = re.sub(rf"\b{re.escape(entity)}\b", " ", text, flags=re.I)

        # 4. Remove standard personal titles, academic packaging & mailbox phrases
        boilerplate_patterns = [
            r"\b(?:prof(?:essor)?|dr\.?|mr\.?|ms\.?|mrs\.?)\b",
            r"\b(?:vit|university|college|campus|semester|winter|fall|mon|tue|wed|thu|fri|sat|sun)\b",
            r"\b(?:digital assignment|da\s*\d*|assignment\s*\d*|homework|viva|quiz|exam)\b",
            r"\b(?:assigned by|assigned to|submitted by|submission for|submit before|due date|deadline)\b",
            r"\b(?:prepare (?:a )?(?:short )?report on|write (?:a )?report on|create (?:a )?report on|report on)\b",
            r"\b(?:re:|fwd:|attn:|urgent|action required|notes on|summary of)\b",
            r"\b(?:please|kindly|hello|hi|dear|regards|best regards|thanks|thank you)\b"
        ]
        for pat in boilerplate_patterns:
            text = re.sub(pat, " ", text, flags=re.I)

        # 5. Collapse spaces and strip residual punctuation
        cleaned = re.sub(r"[^\w\s\-]", " ", text)
        cleaned = re.sub(r"\s+", " ", cleaned).strip()

        # If over-stripped, fallback to core technical words
        if not cleaned or len(cleaned) < 3:
            # Fallback: extract alphabetic terms from original query, discarding emails and PII
            words = [w for w in re.findall(r"\b[A-Za-z]{3,}\b", query) if w.lower() not in [
                "priyam", "trivedi", "rupayan", "assignment", "report", "prepare", "submit", "submission", "vit"
            ]]
            cleaned = " ".join(words[:5])

        return cleaned

    @classmethod
    def filter_threads_for_ai(cls, threads: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """
        Filters threads before they reach Gemini or LM Studio.
        Strips out all threads evaluated as sensitive or ineligible for AI.
        """
        allowed = []
        for t in threads:
            # Check latest message or thread subject/messages
            messages = t.get("messages") or []
            latest_msg = messages[-1] if messages else {}
            sample_item = {
                "sender": latest_msg.get("sender") or latest_msg.get("from") or t.get("sender"),
                "subject": t.get("subject") or latest_msg.get("subject"),
                "snippet": latest_msg.get("snippet") or latest_msg.get("body") or t.get("snippet")
            }
            gate = cls.evaluate(sample_item)
            if gate.get("ai_allowed") is True:
                # Include sanitized thread
                allowed.append(t)
        return allowed

    @classmethod
    def filter_emails_for_work(cls, emails: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """
        Filters emails before passing to autonomous Work Agent.
        Only allows actionable tasks where work_agent_allowed is True.
        """
        allowed = []
        for e in emails:
            gate = cls.evaluate(e)
            if gate.get("work_agent_allowed") is True:
                allowed.append(e)
        return allowed
