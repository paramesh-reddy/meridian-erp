import logging
import smtplib
from datetime import datetime, timezone
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from pathlib import Path
from jinja2 import Environment, FileSystemLoader, select_autoescape
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.system import EmailLog, EmailStatus

logger = logging.getLogger(__name__)

TEMPLATE_DIR = Path(__file__).resolve().parent.parent / "templates"
jinja_env = Environment(
    loader=FileSystemLoader(str(TEMPLATE_DIR)),
    autoescape=select_autoescape(["html", "xml"]),
)


class EmailService:
    def _is_smtp_configured(self) -> bool:
        return bool(
            settings.SMTP_HOST
            and settings.SMTP_USER
            and settings.SMTP_PASSWORD
            and settings.SMTP_USER != "your_email@example.com"
            and settings.SMTP_PASSWORD != "your_app_password"
        )

    def _send_smtp(self, recipient: str, subject: str, html_body: str) -> None:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"] = f"{settings.SMTP_FROM_NAME} <{settings.SMTP_USER}>"
        msg["To"] = recipient
        msg.attach(MIMEText(html_body, "html"))

        with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=15) as server:
            server.starttls()
            server.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
            server.sendmail(settings.SMTP_USER, [recipient], msg.as_string())

    def send_template_email(
        self,
        db: Session,
        recipient: str,
        subject: str,
        template_name: str,
        context: dict,
        reference_order_id: int | None = None,
    ) -> EmailLog:
        template = jinja_env.get_template(f"{template_name}.html")
        body_html = template.render(**context)
        now = datetime.now(timezone.utc)

        if not self._is_smtp_configured():
            log = EmailLog(
                recipient=recipient,
                subject=subject,
                template_name=template_name,
                body_html=body_html,
                reference_order_id=reference_order_id,
                status=EmailStatus.QUEUED_SIMULATED,
                sent_at=now,
            )
            db.add(log)
            db.commit()
            db.refresh(log)
            return log

        try:
            self._send_smtp(recipient, subject, body_html)
            log = EmailLog(
                recipient=recipient,
                subject=subject,
                template_name=template_name,
                body_html=body_html,
                reference_order_id=reference_order_id,
                status=EmailStatus.SENT,
                sent_at=now,
            )
        except Exception as exc:
            logger.error("SMTP delivery failed for %s: %s", recipient, exc)
            log = EmailLog(
                recipient=recipient,
                subject=subject,
                template_name=template_name,
                body_html=body_html,
                reference_order_id=reference_order_id,
                status=EmailStatus.FAILED,
                error_message=str(exc),
            )
        db.add(log)
        db.commit()
        db.refresh(log)
        return log

    def retry_email(self, db: Session, log_id: int) -> EmailLog:
        log = db.get(EmailLog, log_id)
        if not log:
            raise ValueError("Email log not found")
        log.retry_count += 1
        now = datetime.now(timezone.utc)
        if not self._is_smtp_configured():
            log.status = EmailStatus.QUEUED_SIMULATED
            log.error_message = None
            log.sent_at = now
        else:
            try:
                self._send_smtp(log.recipient, log.subject, log.body_html)
                log.status = EmailStatus.SENT
                log.error_message = None
                log.sent_at = now
            except Exception as exc:
                log.status = EmailStatus.FAILED
                log.error_message = str(exc)
        db.commit()
        db.refresh(log)
        return log


email_service = EmailService()
