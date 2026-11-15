"""Who is asking: the identity Cloudflare Access resolved, behind a small port.

The router gets an email or ``None`` and never learns how it was produced.

* ``access_identity`` reads ``ctx.access.getIdentity()``, which Cloudflare documents as
  the signed-in user's identity "When Cloudflare Access authenticates a request that
  directly invokes your Worker", with ``ctx.access`` "undefined if Access did not
  authenticate the request".
  https://developers.cloudflare.com/workers/configuration/cloudflare-access/
  The quiz app (same site, same Python runtime) runs on this and found the lookup can
  miss transiently while sibling requests succeed, so a miss is retried once.
* The local server passes a fixed email instead.

It fails closed: any error, missing binding or missing email is ``None``. There is
deliberately no fallback to the ``Cf-Access-Authenticated-User-Email`` or
``Cf-Access-Jwt-Assertion`` headers: a client can send its own copy of either, and
trusting them unverified would let anyone name any email.
"""

from __future__ import annotations

import asyncio
import json
from urllib.parse import urlsplit

ATTEMPTS = 2


def request_path(request) -> str:
    """The request path, or ``""`` when the URL cannot be read (a JS string over the FFI)."""
    try:
        return urlsplit(str(request.url)).path
    except Exception:
        return ""


def normalize_email(email: str | None) -> str | None:
    """Identity is case-insensitive. Blank is no identity."""
    value = (email or "").strip().lower()
    return value or None


async def access_identity(ctx, path: str, retry_delay_s: float = 0.1, log=print) -> str | None:
    """The email Access authenticated for this request, or ``None``. Never logs the email."""
    try:
        access = getattr(ctx, "access", None)
    except Exception:
        access = None
    if access is None:
        log(json.dumps({"event": "access_identity_missing", "path": path, "branch": "access-missing"}))
        return None
    branches = []
    for attempt in range(ATTEMPTS):
        if attempt:
            await asyncio.sleep(retry_delay_s)
        try:
            email = normalize_email(getattr(await access.getIdentity(), "email", None))
        except Exception as error:  # fail closed: a surprise from the binding is a miss
            branches.append(f"identity-threw:{type(error).__name__}")
            continue
        if email:
            if branches:
                log(json.dumps({"event": "access_identity_recovered", "path": path, "branches": branches}))
            return email
        branches.append("no-email")
    log(json.dumps({"event": "access_identity_missing", "path": path, "branches": branches}))
    return None
