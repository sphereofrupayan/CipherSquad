import json
from typing import Any, Dict

class ObservationNormalizer:
    """Normalizes and truncates tool execution results for agent consumption."""

    MAX_OBSERVATION_LENGTH = 1500

    @classmethod
    def normalize(cls, result: Any, error: str = "") -> Dict[str, Any]:
        if error:
            return {
                "ok": False,
                "error": str(error)[:cls.MAX_OBSERVATION_LENGTH]
            }

        if isinstance(result, dict):
            # Check if dict itself has ok flag
            res_dict = dict(result)
            if "ok" not in res_dict:
                res_dict["ok"] = True
            return res_dict

        if isinstance(result, (list, tuple)):
            return {
                "ok": True,
                "items": result[:10],
                "total": len(result)
            }

        res_str = str(result or "")
        if len(res_str) > cls.MAX_OBSERVATION_LENGTH:
            res_str = res_str[:cls.MAX_OBSERVATION_LENGTH] + "... [truncated]"

        return {
            "ok": True,
            "data": res_str
        }
