"""Domain errors. The router maps each to an HTTP status and an ``{"error", "code"}`` body."""

from __future__ import annotations


class TrackError(Exception):
    status = 500

    def __init__(self, message: str, code: str = ""):
        super().__init__(message)
        self.message = message
        self.code = code


class NotFound(TrackError):
    status = 404


class Conflict(TrackError):
    """The request is valid but the tracker's state does not allow it right now."""

    status = 409


class Invalid(TrackError):
    status = 422
