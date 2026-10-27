"""
Emailed account links: set/change password and confirm an added email.

Both flows send a short-lived signed link. The link opens a small HTML page
served from here (so no website or deep-link setup is needed), which posts a
form back to finish the job.

- Password: one flow for "set" (Apple/Google accounts have no password) and
  "change". The token carries a fingerprint of the current password hash, so
  a link dies once it has been used or the password changes some other way.
- Email: proves the person owns an address. Used after email/password
  sign-up (until then the email can't link Apple/Google sign-ins), and when
  someone Apple signed in without an email adds one — it's only saved once
  they click, so nobody can claim an address they don't own. Using a password
  link also proves the email, since it was sent there.
"""
from __future__ import annotations

import hashlib
import html
import uuid

from fastapi import APIRouter, Depends, Form, HTTPException, Request, status
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, EmailStr
from sqlalchemy import select, func as sqlfunc
from sqlalchemy.ext.asyncio import AsyncSession

from core.config import settings
from core.database import get_db
from core.rate_limit import limiter
from core.security import create_link_token, decode_token, hash_password
from middleware.auth import get_current_user
from models.user import User
from services.email import send_email

router = APIRouter(tags=["account links"])

PASSWORD_LINK_MINUTES = 60
EMAIL_LINK_MINUTES = 24 * 60
MIN_PASSWORD = 8
MAX_PASSWORD = 128  # bcrypt ignores bytes past 72; this just bounds the input


class ForgotRequest(BaseModel):
    email: EmailStr


class AddEmailRequest(BaseModel):
    email: EmailStr


# --- Helpers ---

def _password_fingerprint(user: User) -> str:
    return hashlib.sha256((user.hashed_password or "none").encode()).hexdigest()[:16]


async def _find_by_email(email: str, db: AsyncSession) -> User | None:
    result = await db.execute(select(User).where(sqlfunc.lower(User.email) == email.lower()))
    return result.scalar_one_or_none()


async def _user_from_token(token: str, purpose: str, db: AsyncSession) -> User | None:
    payload = decode_token(token)
    if payload.get("type") != purpose:
        return None
    try:
        return await db.get(User, uuid.UUID(payload["sub"]))
    except (KeyError, ValueError):
        return None


def _email_html(heading: str, body: str, button: str, url: str) -> str:
    return f"""<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#111">
<h2 style="margin:0 0 12px">{heading}</h2>
<p style="line-height:1.5;margin:0 0 20px">{body}</p>
<p><a href="{html.escape(url)}" style="display:inline-block;background:#2f6bff;color:#fff;text-decoration:none;padding:12px 20px;border-radius:10px;font-weight:600">{button}</a></p>
<p style="color:#666;font-size:13px;line-height:1.5;margin-top:24px">If you didn't ask for this, you can ignore this email.</p>
</div>"""


async def _send_password_link(user: User) -> None:
    token = create_link_token(
        str(user.id), "pw_link", PASSWORD_LINK_MINUTES, pwf=_password_fingerprint(user)
    )
    url = f"{settings.PUBLIC_API_URL}/auth/password/reset?token={token}"
    verb = "change" if user.has_password else "set"
    await send_email(
        to=user.email,
        subject=f"{verb.capitalize()} your GainRace password",
        text=f"Open this link to {verb} your GainRace password. It works for 1 hour.\n\n{url}\n\n"
        "If you didn't ask for this, you can ignore this email.",
        html=_email_html(
            f"{verb.capitalize()} your password",
            f"Tap the button to {verb} your GainRace password. The link works for 1 hour.",
            f"{verb.capitalize()} password",
            url,
        ),
    )


async def send_email_confirm_link(user: User, email: str) -> None:
    token = create_link_token(str(user.id), "email_confirm", EMAIL_LINK_MINUTES, email=email)
    url = f"{settings.PUBLIC_API_URL}/auth/email/confirm?token={token}"
    await send_email(
        to=email,
        subject="Confirm your GainRace email",
        text=f"Open this link to confirm this email for your GainRace account. It works for 24 hours.\n\n{url}\n\n"
        "If you didn't ask for this, you can ignore this email.",
        html=_email_html(
            "Confirm your email",
            "Tap the button to confirm this email for your GainRace account. The link works for 24 hours.",
            "Confirm email",
            url,
        ),
    )


def _page(title: str, body: str, status_code: int = 200) -> HTMLResponse:
    return HTMLResponse(
        f"""<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>{title} · GainRace</title>
<style>
body{{margin:0;background:#0b0b0d;color:#f2f2f4;font-family:-apple-system,Segoe UI,Roboto,sans-serif}}
main{{max-width:420px;margin:0 auto;padding:56px 16px}}
h1{{font-size:24px;margin:0 0 12px}} p{{color:#a1a1aa;line-height:1.5}}
label{{display:block;font-size:14px;font-weight:600;margin:16px 0 6px}}
input{{box-sizing:border-box;width:100%;padding:14px;border-radius:12px;border:1px solid #2c2c31;background:#1c1c20;color:#f2f2f4;font-size:16px}}
button{{width:100%;margin-top:24px;padding:14px;border:0;border-radius:12px;background:#2f6bff;color:#fff;font-size:16px;font-weight:600}}
.err{{color:#f87171}}
</style></head><body><main>{body}</main></body></html>""",
        status_code=status_code,
    )


def _expired_page() -> HTMLResponse:
    return _page(
        "Link expired",
        "<h1>This link has expired</h1><p>It may have been used already. Request a new one in the GainRace app.</p>",
        status.HTTP_400_BAD_REQUEST,
    )


def _password_form(token: str, verb: str, error: str | None = None) -> HTMLResponse:
    err = f'<p class="err">{html.escape(error)}</p>' if error else ""
    return _page(
        f"{verb.capitalize()} password",
        f"""<h1>{verb.capitalize()} your password</h1>
<p>Use at least {MIN_PASSWORD} characters. You can then sign in with your email and this password.</p>{err}
<form method="post" action="/auth/password/reset">
<input type="hidden" name="token" value="{html.escape(token)}">
<label for="p1">New password</label><input id="p1" name="password" type="password" autocomplete="new-password" minlength="{MIN_PASSWORD}" maxlength="{MAX_PASSWORD}" required>
<label for="p2">Repeat password</label><input id="p2" name="confirm" type="password" autocomplete="new-password" minlength="{MIN_PASSWORD}" maxlength="{MAX_PASSWORD}" required>
<button type="submit">Save password</button></form>""",
        400 if error else 200,
    )


# --- Password ---

@router.post("/auth/password/link", status_code=status.HTTP_202_ACCEPTED)
@limiter.limit("3/hour")
async def request_password_link(request: Request, current_user: User = Depends(get_current_user)):
    """Settings → Password. Emails a set/change link to the account's email."""
    if not current_user.email:
        raise HTTPException(400, "Add an email to your account first.")
    await _send_password_link(current_user)
    return {"sent_to": current_user.email}


@router.post("/auth/password/forgot", status_code=status.HTTP_202_ACCEPTED)
@limiter.limit("5/hour")
async def forgot_password(request: Request, body: ForgotRequest, db: AsyncSession = Depends(get_db)):
    """Login → Forgot password. Same answer whether or not the email exists."""
    user = await _find_by_email(body.email, db)
    if user:
        await _send_password_link(user)
    return {"ok": True}


@router.get("/auth/password/reset", response_class=HTMLResponse, include_in_schema=False)
async def password_reset_page(token: str = "", db: AsyncSession = Depends(get_db)):
    user = await _user_from_token(token, "pw_link", db)
    if not user or decode_token(token).get("pwf") != _password_fingerprint(user):
        return _expired_page()
    return _password_form(token, "change" if user.has_password else "set")


@router.post("/auth/password/reset", response_class=HTMLResponse, include_in_schema=False)
@limiter.limit("10/hour")
async def password_reset_submit(
    request: Request,
    token: str = Form(""),
    password: str = Form(""),
    confirm: str = Form(""),
    db: AsyncSession = Depends(get_db),
):
    user = await _user_from_token(token, "pw_link", db)
    if not user or decode_token(token).get("pwf") != _password_fingerprint(user):
        return _expired_page()
    verb = "change" if user.has_password else "set"
    if not MIN_PASSWORD <= len(password) <= MAX_PASSWORD:
        return _password_form(token, verb, f"Use {MIN_PASSWORD} to {MAX_PASSWORD} characters.")
    if password != confirm:
        return _password_form(token, verb, "The passwords don't match.")

    user.hashed_password = hash_password(password)
    user.email_verified = True  # the link was sent to this address
    await db.commit()
    return _page(
        "Password saved",
        f"<h1>Password saved</h1><p>You can now sign in to GainRace with {html.escape(user.email or 'your email')} "
        "and your new password. You can close this page.</p>",
    )


# --- Add email ---

@router.post("/users/me/email", status_code=status.HTTP_202_ACCEPTED)
@limiter.limit("5/hour")
async def add_email(
    request: Request,
    body: AddEmailRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Emails a confirm link; the address is saved only when it's clicked."""
    if current_user.email:
        raise HTTPException(409, "Your account already has an email.")
    if await _find_by_email(body.email, db):
        raise HTTPException(409, "That email is already used by another account.")

    await send_email_confirm_link(current_user, body.email)
    return {"sent_to": body.email}


@router.post("/users/me/email/confirm-link", status_code=status.HTTP_202_ACCEPTED)
@limiter.limit("3/hour")
async def resend_email_confirm(request: Request, current_user: User = Depends(get_current_user)):
    """Settings → Email (unconfirmed). Re-sends the confirm link."""
    if not current_user.email:
        raise HTTPException(400, "Add an email to your account first.")
    if current_user.email_verified:
        raise HTTPException(409, "Your email is already confirmed.")
    await send_email_confirm_link(current_user, current_user.email)
    return {"sent_to": current_user.email}


@router.get("/auth/email/confirm", response_class=HTMLResponse, include_in_schema=False)
async def confirm_email_page(token: str = "", db: AsyncSession = Depends(get_db)):
    # A button rather than confirming on GET: mail scanners open links on their own.
    user = await _user_from_token(token, "email_confirm", db)
    if not user:
        return _expired_page()
    email = html.escape(decode_token(token).get("email", ""))
    return _page(
        "Confirm email",
        f"""<h1>Confirm your email</h1><p>Confirm <strong>{email}</strong> as the email for your GainRace account?</p>
<form method="post" action="/auth/email/confirm"><input type="hidden" name="token" value="{html.escape(token)}">
<button type="submit">Confirm email</button></form>""",
    )


@router.post("/auth/email/confirm", response_class=HTMLResponse, include_in_schema=False)
@limiter.limit("10/hour")
async def confirm_email_submit(request: Request, token: str = Form(""), db: AsyncSession = Depends(get_db)):
    user = await _user_from_token(token, "email_confirm", db)
    email = decode_token(token).get("email")
    if not user or not email:
        return _expired_page()
    if user.email and user.email.lower() == email.lower():
        user.email_verified = True
        await db.commit()
        return _page("Email confirmed", "<h1>Email confirmed</h1><p>You can close this page.</p>")
    if user.email:
        return _expired_page()
    other = await _find_by_email(email, db)
    if other:
        return _page(
            "Email in use",
            "<h1>That email is taken</h1><p>Another GainRace account already uses it.</p>",
            status.HTTP_409_CONFLICT,
        )

    user.email = email
    user.email_verified = True
    await db.commit()
    return _page(
        "Email confirmed",
        f"<h1>Email confirmed</h1><p>{html.escape(email)} is now on your GainRace account. "
        "Back in the app you can set a password from Settings → Profile.</p>",
    )
