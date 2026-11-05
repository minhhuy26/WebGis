"""
Cấu hình ứng dụng – đọc từ file .env
"""
import os
from pathlib import Path
from dotenv import load_dotenv

# Tìm file .env ở thư mục gốc dự án (2 cấp trên backend/app/)
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
load_dotenv(PROJECT_ROOT / ".env")


class Settings:
    """Tập trung toàn bộ cấu hình, lấy giá trị từ biến môi trường."""

    # --- PostgreSQL / PostGIS ---
    DB_HOST: str = os.getenv("DB_HOST", "localhost")
    DB_PORT: int = int(os.getenv("DB_PORT", "5432"))
    DB_NAME: str = os.getenv("DB_NAME", "tvdi_webgis")
    DB_USER: str = os.getenv("DB_USER", "postgres")
    DB_PASSWORD: str = os.getenv("DB_PASSWORD", "")

    @property
    def DATABASE_URL(self) -> str:
        env_url = os.getenv("DATABASE_URL")
        if env_url:
            if env_url.startswith("postgres://"):
                return env_url.replace("postgres://", "postgresql+psycopg2://", 1)
            elif env_url.startswith("postgresql://") and not env_url.startswith("postgresql+psycopg2://"):
                return env_url.replace("postgresql://", "postgresql+psycopg2://", 1)
            return env_url
        return (
            f"postgresql+psycopg2://{self.DB_USER}:{self.DB_PASSWORD}"
            f"@{self.DB_HOST}:{self.DB_PORT}/{self.DB_NAME}"
        )

    # --- Đường dẫn dữ liệu (đường dẫn tương đối được tính từ thư mục gốc dự án) ---
    _data_dir = Path(os.getenv("DATA_DIR", "data"))
    DATA_DIR: Path = _data_dir if _data_dir.is_absolute() else (PROJECT_ROOT / _data_dir).resolve()

    # --- Server ---
    API_HOST: str = os.getenv("API_HOST", "0.0.0.0")
    API_PORT: int = int(os.getenv("PORT", os.getenv("API_PORT", "8000")))

    # --- Phân loại mức khô hạn TVDI (8 cấp, bước 0.125) ---
    TVDI_CLASSES = [
        {"min": 0.000, "max": 0.125, "label": "Rất ẩm / Ngập nước",
         "description": "Đất bão hòa nước hoặc ngập úng, thực vật phát triển mạnh",
         "color": "#066b00"},
        {"min": 0.125, "max": 0.250, "label": "Ẩm ướt",
         "description": "Đất có độ ẩm cao, điều kiện sinh trưởng rất thuận lợi",
         "color": "#0bc400"},
        {"min": 0.250, "max": 0.375, "label": "Đủ ẩm, phát triển tốt",
         "description": "Độ ẩm đất đầy đủ, thực vật phát triển tốt",
         "color": "#0ce100"},
        {"min": 0.375, "max": 0.500, "label": "Bình thường",
         "description": "Độ ẩm đất ở mức bình thường, thực vật ổn định",
         "color": "#00ff00"},
        {"min": 0.500, "max": 0.625, "label": "Bắt đầu khô hạn nhẹ",
         "description": "Đất bắt đầu thiếu nước nhẹ, thực vật chịu áp lực",
         "color": "#ffff00"},
        {"min": 0.625, "max": 0.750, "label": "Hạn vừa",
         "description": "Đất thiếu nước rõ rệt, thực vật bắt đầu héo",
         "color": "#ffcc00"},
        {"min": 0.750, "max": 0.875, "label": "Hạn nặng",
         "description": "Đất thiếu hụt độ ẩm nghiêm trọng, thực vật héo rũ",
         "color": "#ff6600"},
        {"min": 0.875, "max": 1.000, "label": "Hạn gay gắt / Khô khốc",
         "description": "Đất kiệt nước nghiêm trọng, cây trồng suy thoái hoặc chết",
         "color": "#ff0000"},
    ]


    # --- Google Earth Engine (GEE) ---
    EE_PROJECT_ID: str = os.getenv("EE_PROJECT_ID", "")
    EE_SERVICE_ACCOUNT: str = os.getenv("EE_SERVICE_ACCOUNT", "")
    EE_PRIVATE_KEY_FILE: str = os.getenv("EE_PRIVATE_KEY_FILE", "")

settings = Settings()
