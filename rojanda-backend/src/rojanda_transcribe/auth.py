"""Authenticated identity boundary for the RojAnda API (Phase 1A).

Single, testable place that turns an API Gateway request into a verified
AuthContext. The authoritative owner id is the Cognito **User Pool `sub`**,
taken ONLY from the JWT claims that API Gateway's JWT authorizer has already
verified (signature, issuer, audience, expiry). We never read an owner/user id
from the request body, query string, headers, or path — those are
client-controlled and are not proof of ownership.

Fail closed: any missing/malformed authentication context raises Unauthorized
(HTTP 401). There is no fallback to an unauthenticated or guest owner.

This module has no boto3/network dependencies so it is trivially unit-testable
and carries the security-critical identity logic with no I/O side effects.
"""
from __future__ import annotations

import re
from dataclasses import dataclass

from .core import ClientError

# Cognito User Pool `sub` is a UUID (v4). We validate the shape defensively; the
# value's authenticity is already guaranteed by the API Gateway JWT authorizer.
_SUB_RE = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")


@dataclass(frozen=True)
class AuthContext:
    """The verified caller. `owner_id` is the authoritative ownership key.

    `owner_id` == the Cognito User Pool `sub`. It is immutable and is the only
    value used to scope S3 keys / DynamoDB partitions. `email` is informational
    only (mutable; NEVER used for authorization/ownership)."""

    owner_id: str
    email: str | None = None


def _jwt_claims(event: dict) -> dict:
    """Return the verified JWT claims from the API Gateway (HTTP API v2) JWT
    authorizer. Shape: requestContext.authorizer.jwt.claims.{sub,email,...}.
    Returns {} when absent (caller treats that as unauthenticated)."""
    rc = (event or {}).get("requestContext", {}) or {}
    authorizer = rc.get("authorizer") or {}
    jwt = authorizer.get("jwt") or {}
    claims = jwt.get("claims") or {}
    return claims if isinstance(claims, dict) else {}


def get_auth_context(event: dict) -> AuthContext:
    """Derive the verified AuthContext from the request, or fail closed (401).

    Owner id = verified JWT `sub`. We deliberately do NOT look at the body,
    query, headers, or path for any ownership identifier.
    """
    claims = _jwt_claims(event)
    sub = claims.get("sub")

    if not sub or not isinstance(sub, str) or not _SUB_RE.match(sub):
        # Missing / malformed authenticated identity -> unauthorized. No guest,
        # no client-supplied fallback.
        raise ClientError(401, "unauthorized", "Kimlik doğrulanamadı.")

    email = claims.get("email")
    return AuthContext(owner_id=sub, email=email if isinstance(email, str) else None)


def get_owner_id(event: dict) -> str:
    """Convenience: the verified owner id (Cognito sub). Fails closed."""
    return get_auth_context(event).owner_id
