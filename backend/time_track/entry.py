"""Cloudflare Workers (Python) entrypoint over ``api.handle``.

``Default`` extends ``WorkerEntrypoint``: bindings come from ``self.env`` and the Access
identity from ``self.ctx``. https://developers.cloudflare.com/workers/languages/python/
"""

from __future__ import annotations

import json
import time

from workers import Response, WorkerEntrypoint

from .api import HEADERS, decode_body, handle
from .auth import access_identity, request_path


def _response(status: int, body: dict | None) -> Response:
    if status == 204 or body is None:
        # An empty string, not None: empty-string bodies are proven on Python Workers.
        return Response("", headers=HEADERS, status=status)
    return Response(json.dumps(body), headers={"content-type": "application/json", **HEADERS}, status=status)


class Default(WorkerEntrypoint):
    async def fetch(self, request):
        method = str(request.method).upper()
        body = decode_body(str(await request.text())) if method in ("POST", "PUT", "PATCH") else None
        path = request_path(request)
        email = await access_identity(getattr(self, "ctx", None), path)
        status, payload = await handle(self.env.DB, method, path, body, email, time.time_ns() // 1_000_000)
        return _response(status, payload)
