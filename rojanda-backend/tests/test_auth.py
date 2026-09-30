"""Auth-boundary tests (Phase 1A): verified JWT `sub` -> ownerId, fail-closed.

Run:
    PYTHONPATH=src python -m unittest discover -s tests -v
"""
import os
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
os.environ.setdefault("ROJANDA_MEDIA_BUCKET", "rojanda-media-test")
os.environ.setdefault("ROJANDA_USAGE_TABLE", "rojanda-usage-test")

from rojanda_transcribe import auth  # noqa: E402
from rojanda_transcribe.core import ClientError  # noqa: E402

SUB = "11111111-1111-4111-8111-111111111111"
OTHER_SUB = "22222222-2222-4222-8222-222222222222"


def jwt_event(sub=SUB, email="s@example.com", extra_body=None, extra_query=None):
    claims = {}
    if sub is not None:
        claims["sub"] = sub
    if email is not None:
        claims["email"] = email
    return {
        "requestContext": {"authorizer": {"jwt": {"claims": claims}}},
        "body": extra_body,
        "queryStringParameters": extra_query,
    }


class AuthContextTests(unittest.TestCase):
    def test_verified_sub_becomes_owner_id(self):
        ctx = auth.get_auth_context(jwt_event(sub=SUB))
        self.assertEqual(ctx.owner_id, SUB)
        self.assertEqual(auth.get_owner_id(jwt_event(sub=SUB)), SUB)

    def test_email_is_informational_not_ownership(self):
        ctx = auth.get_auth_context(jwt_event(sub=SUB, email="a@b.co"))
        # email is carried but is NOT the owner id
        self.assertEqual(ctx.email, "a@b.co")
        self.assertEqual(ctx.owner_id, SUB)
        self.assertNotEqual(ctx.owner_id, ctx.email)

    def test_client_supplied_owner_in_body_cannot_override(self):
        # A malicious body claims a different owner; the boundary ignores it.
        ev = jwt_event(sub=SUB, extra_body='{"ownerId":"' + OTHER_SUB + '","userId":"x"}')
        self.assertEqual(auth.get_owner_id(ev), SUB)

    def test_client_supplied_owner_in_query_cannot_override(self):
        ev = jwt_event(sub=SUB, extra_query={"ownerId": OTHER_SUB, "sub": OTHER_SUB})
        self.assertEqual(auth.get_owner_id(ev), SUB)

    def test_missing_sub_fails_closed(self):
        with self.assertRaises(ClientError) as cm:
            auth.get_auth_context(jwt_event(sub=None))
        self.assertEqual(cm.exception.status, 401)

    def test_missing_authorizer_fails_closed(self):
        with self.assertRaises(ClientError) as cm:
            auth.get_auth_context({"requestContext": {}})
        self.assertEqual(cm.exception.status, 401)

    def test_empty_event_fails_closed(self):
        with self.assertRaises(ClientError) as cm:
            auth.get_auth_context({})
        self.assertEqual(cm.exception.status, 401)

    def test_malformed_sub_fails_closed(self):
        for bad in ["not-a-uuid", "", "12345", "us-east-1:" + SUB, "'; DROP TABLE"]:
            with self.assertRaises(ClientError) as cm:
                auth.get_auth_context(jwt_event(sub=bad))
            self.assertEqual(cm.exception.status, 401, bad)

    def test_iam_identity_shape_is_not_accepted(self):
        # The OLD Identity-Pool shape must NOT authenticate under JWT auth.
        ev = {"requestContext": {"authorizer": {"iam": {"cognitoIdentity": {"identityId": "us-east-1:" + SUB}}}}}
        with self.assertRaises(ClientError) as cm:
            auth.get_auth_context(ev)
        self.assertEqual(cm.exception.status, 401)


if __name__ == "__main__":
    unittest.main()
