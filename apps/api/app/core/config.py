from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # Database
    DATABASE_URL: str
    SYNC_DATABASE_URL: str

    # Redis / Celery
    REDIS_URL: str = "redis://localhost:6379/0"

    # Google AI
    GOOGLE_API_KEY: str
    CLOUD_LLM: str = "gemini-2.0-flash"

    # Auth
    JWT_SECRET: str
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 15
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7
    DEVICE_TOKEN_EXPIRE_DAYS: int = 30

    # CORS
    DASHBOARD_URL: str = "http://localhost:3000"

    # Server
    PORT: int = 3001
    ENVIRONMENT: str = "development"

    # File storage
    UPLOAD_DIR: str = "./uploads"
    FAISS_EXPORT_DIR: str = "./exports"
    MAX_UPLOAD_SIZE_MB: int = 50

    @property
    def max_upload_size_bytes(self) -> int:
        return self.MAX_UPLOAD_SIZE_MB * 1024 * 1024

    @property
    def is_development(self) -> bool:
        return self.ENVIRONMENT == "development"


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
