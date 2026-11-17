import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.base import Base
from app.db.seed import seed_initial_data
from app.db.session import get_db
from app.main import app


@pytest.fixture()
def db_session():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    TestingSession = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    session = TestingSession()
    seed_initial_data(session)
    try:
        yield session
    finally:
        session.close()


@pytest.fixture()
def client(db_session, monkeypatch):
    def override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = override_get_db
    sent_emails = []

    def fake_send_template(db, recipient, subject, template_name, context, reference_order_id=None):
        sent_emails.append({"recipient": recipient, "subject": subject, "template": template_name})
        return None

    monkeypatch.setattr("app.services.email_service.email_service.send_template_email", fake_send_template)
    with TestClient(app) as c:
        c.sent_emails = sent_emails
        yield c
    app.dependency_overrides.clear()
