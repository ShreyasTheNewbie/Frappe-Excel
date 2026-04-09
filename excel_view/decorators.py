# Copyright (c) 2026, Ujjwal Aggrawal and contributors
# For license information, please see license.txt

"""
excel_view.decorators — @excel_whitelist() decorator

A drop-in, security-hardened replacement for @frappe.whitelist().

Why not just @frappe.whitelist()?
  - @frappe.whitelist() only registers the function and handles guest access.
    Security checks (roles, permissions, rate-limits) must be written manually
    in every endpoint — error-prone, inconsistent, easy to forget.
  - @excel_whitelist() makes all security properties *declarative* on the
    function signature, making it impossible to accidentally skip them.

Feature matrix vs @frappe.whitelist():
  ┌─────────────────────────────┬───────────────┬──────────────────┐
  │ Capability                  │ frappe.wl()   │ excel_whitelist() │
  ├─────────────────────────────┼───────────────┼──────────────────┤
  │ Frappe whitelist registr.   │ ✓             │ ✓ (wraps it)     │
  │ Guest access flag           │ ✓             │ ✓                │
  │ Role-based access           │ manual throw  │ ✓ declarative    │
  │ HTTP method enforcement     │ ✗             │ ✓ declarative    │
  │ DocType perm check          │ manual call   │ ✓ declarative    │
  │ Redis rate limiting         │ ✗             │ ✓ atomic          │
  │ Audit trail                 │ ✗             │ ✓ structured log │
  │ CSRF always enforced        │ xss_safe bypass│ ✓ never bypassed │
  │ Sensitive kwarg scrubbing   │ ✗             │ ✓ in audit log   │
  └─────────────────────────────┴───────────────┴──────────────────┘

Usage:

    from excel_view.decorators import excel_whitelist

    # Simple: any logged-in user, no extra checks
    @excel_whitelist()
    def get_workbooks(): ...

    # Role guard
    @excel_whitelist(roles=["System Manager"])
    def reset_permissions(doctype): ...

    # POST-only + role + doctype read-perm + audit trail
    @excel_whitelist(
        roles=["System Manager"],
        methods=["POST"],
        doctype_perm=("doctype", "read"),
        audit=True,
    )
    def update_role_permission(doctype, role, ptype, value): ...

    # Rate-limited data endpoint: max 120 calls / 60 s per user
    @excel_whitelist(
        doctype_perm=("doctype", "read"),
        rate_limit={"calls": 120, "seconds": 60},
    )
    def get_formula_values(doctype, filters): ...
"""

import functools
import frappe
from frappe import _

# ── Sensitive kwarg names stripped from audit logs ─────────────────────────────
_SENSITIVE_KEYS = frozenset({
    "password", "secret", "token", "key", "api_key",
    "api_secret", "private_key", "auth", "credential",
})


def excel_whitelist(
    roles=None,
    methods=None,
    doctype_perm=None,
    rate_limit=None,
    audit=False,
    allow_guest=False,
):
    """
    Decorator — see module docstring for full docs.

    Args:
        roles (list[str] | None):
            Any user whose role-set intersects *roles* is allowed.
            Raises PermissionError otherwise.
            Example: roles=["System Manager", "Administrator"]

        methods (list[str] | None):
            Restrict to specific HTTP methods.
            Example: methods=["POST"]  — rejects GET, HEAD, etc.

        doctype_perm (tuple[str, str] | None):
            (kwarg_name, perm_type) — after role/method checks, read the
            value of *kwarg_name* from the call and run
            frappe.has_permission(value, perm_type, throw=True).
            Example: doctype_perm=("doctype", "write")

        rate_limit (dict | None):
            {"calls": N, "seconds": S} — per-user, per-endpoint, atomic
            Redis counter.  Fails open if Redis is unavailable.
            Example: rate_limit={"calls": 60, "seconds": 60}

        audit (bool):
            Emit a structured log line to the "excel_view.audit" logger
            after every successful call.  Sensitive kwargs are scrubbed.

        allow_guest (bool):
            Passed through to Frappe's whitelist mechanism.  Allows
            unauthenticated access.  Almost never needed.
    """

    def decorator(fn):
        @functools.wraps(fn)
        def wrapper(*args, **kwargs):
            # ── 1. Role guard ────────────────────────────────────────────────
            if roles:
                _check_roles(roles)

            # ── 2. Rate limiting ─────────────────────────────────────────────
            if rate_limit:
                _enforce_rate_limit(fn.__name__, rate_limit)

            # ── 3. DocType-level permission ───────────────────────────────────
            if doctype_perm:
                arg_name, perm_type = doctype_perm
                doctype = kwargs.get(arg_name)
                if doctype:
                    frappe.has_permission(doctype, perm_type, throw=True)

            # ── 4. Execute ───────────────────────────────────────────────────
            result = fn(*args, **kwargs)

            # ── 5. Audit trail (after success — not on exception) ────────────
            if audit:
                _audit_log(fn.__name__, kwargs)

            return result

        # ── Delegate ALL registration to frappe.whitelist() ──────────────────
        # frappe.whitelist() handles:
        #   - frappe.whitelisted.append(fn)
        #   - frappe.allowed_http_methods_for_whitelisted_func[fn] = methods
        #   - validate_argument_types wrapping
        #   - guest_methods / xss_safe_methods lists
        #
        # Passing our `methods` here gives Frappe-level HTTP enforcement at the
        # handler layer — no need to duplicate it inside the wrapper.
        # `methods=None` makes Frappe default to ["GET","POST","PUT","DELETE"].
        return frappe.whitelist(allow_guest=allow_guest, methods=methods)(wrapper)

    return decorator


# ── Internal helpers ───────────────────────────────────────────────────────────

def _check_roles(roles: list) -> None:
    """Raise PermissionError if the current user holds none of *roles*."""
    user_roles = set(frappe.get_roles())
    if not user_roles.intersection(roles):
        frappe.throw(
            _("You need one of the following roles to perform this action: {0}").format(
                ", ".join(roles)
            ),
            exc=frappe.PermissionError,
        )



def _enforce_rate_limit(fn_name: str, config: dict) -> None:
    """
    Atomic per-user rate limit using Redis INCR + EXPIRE.

    Uses a pipeline so the incr and expire are sent in a single round-trip.
    Counter key: ev_rl:{user}:{fn_name}

    Fails open (no exception) if Redis is unavailable — never blocks a
    legitimate request due to infrastructure issues.
    """
    calls   = int(config.get("calls",   60))
    seconds = int(config.get("seconds", 60))
    key     = f"ev_rl:{frappe.session.user}:{fn_name}"

    try:
        cache = frappe.cache   # Frappe v14+: property (RedisCacheClient)
        pipe  = cache.pipeline()
        pipe.incr(key)
        pipe.expire(key, seconds)
        count = pipe.execute()[0]
    except Exception:
        # Redis unavailable — fail open; never crash the request
        return

    if count > calls:
        frappe.throw(
            _("Rate limit exceeded ({0} calls per {1}s). Please wait before retrying.").format(
                calls, seconds
            ),
            exc=frappe.PermissionError,
        )


def _audit_log(fn_name: str, kwargs: dict) -> None:
    """
    Non-blocking audit trail.

    Logs to "excel_view.audit" logger (goes to sites/{site}/logs/excel_view.audit.log).
    Sensitive keys (password, secret, token, …) are scrubbed from the log.
    Exceptions are silently swallowed — audit must never crash the real request.
    """
    try:
        safe_kwargs = {
            k: "***" if k.lower() in _SENSITIVE_KEYS else v
            for k, v in kwargs.items()
        }
        frappe.logger("excel_view.audit").info(
            "[ExcelView API] endpoint=%s user=%s ip=%s args=%s",
            fn_name,
            frappe.session.user,
            frappe.local.request_ip if hasattr(frappe.local, "request_ip") else "-",
            safe_kwargs,
        )
    except Exception:
        pass
