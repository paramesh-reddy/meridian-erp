from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parents[2]
DATA_DIR = BACKEND_DIR / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)
DEFAULT_DATABASE_URL = "sqlite:///" + (DATA_DIR / "meridian.db").as_posix()


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(BACKEND_DIR / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    APP_NAME: str = "Meridian ERP Sales & Inventory API"
    API_V1_PREFIX: str = "/api/v1"
    # Local file database so `npm run dev` starts without Docker or a MySQL install.
    # Set DATABASE_URL=mysql+pymysql://root:password@localhost:3306/sales_inventory to use MySQL.
    DATABASE_URL: str = DEFAULT_DATABASE_URL

    SECRET_KEY: str = "dev-secret-change-in-production"
    REFRESH_SECRET_KEY: str = "dev-refresh-secret-change-in-production"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7

    SMTP_HOST: str = "smtp.gmail.com"
    SMTP_PORT: int = 587
    SMTP_USER: str = "your_email@example.com"
    SMTP_PASSWORD: str = "your_app_password"
    SMTP_FROM_NAME: str = "Meridian ERP Approvals"
    MANAGER_EMAIL: str = "manager@example.com"

    FRONTEND_URL: str = "http://localhost:5173"
    CORS_ORIGINS: str = "http://localhost:5173,http://127.0.0.1:5173"


settings = Settings()
