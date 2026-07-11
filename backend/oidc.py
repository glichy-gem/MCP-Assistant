"""Google OIDC single sign-on (Authorization Code flow via Authlib).

Google proves *identity* only; roles and tool grants stay app-owned in Postgres.
If the GOOGLE_* env vars aren't all set, SSO is simply disabled and the app keeps
working with local username/password login.
"""

from __future__ import annotations

import os

from authlib.integrations.starlette_client import OAuth

_REQUIRED = ("GOOGLE_ISSUER", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REDIRECT_URI")

_oauth: OAuth | None = None


def google_enabled() -> bool:
    """True only when every required Google setting is present."""
    return all((os.environ.get(k) or "").strip() for k in _REQUIRED)


def redirect_uri() -> str:
    return os.environ["GOOGLE_REDIRECT_URI"].strip()


def post_login_redirect() -> str:
    return (os.environ.get("GOOGLE_POST_LOGIN_REDIRECT") or "/").strip() or "/"


def get_oauth() -> OAuth:
    """Lazily build the Authlib client from Google's discovery document."""
    global _oauth
    if _oauth is None:
        issuer = os.environ["GOOGLE_ISSUER"].strip().rstrip("/")
        oauth = OAuth()
        oauth.register(
            name="google",
            client_id=os.environ["GOOGLE_CLIENT_ID"].strip(),
            client_secret=os.environ["GOOGLE_CLIENT_SECRET"].strip(),
            server_metadata_url=f"{issuer}/.well-known/openid-configuration",
            client_kwargs={
                "scope": (os.environ.get("GOOGLE_SCOPES") or "openid profile email").strip(),
            },
        )
        _oauth = oauth
    return _oauth
