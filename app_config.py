from dataclasses import dataclass
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent.parent / "data"

LOG_INTERVAL_SECONDS = 5 * 60
DB_PATH = DATA_DIR / "worker_safety.db"

SIGNAL_TIMEOUT_SECONDS = 2.0

STANDING_LOCK_FILE = DATA_DIR / "standing_lock.json"
LOCK_STILL_SECONDS = 2.0
LOCK_MIN_G = 0.85

MANUAL_UP = None

FRONT_AXIS = ("z", -1)

@dataclass
class Thresholds:

    impact_g: float = 2.5
    tilt_deg: float = 60.0
    confirm_seconds: float = 2.0
    lying_seconds: float = 8.0
    still_band_g: float = 0.15

PRESETS = {
    "low": Thresholds(impact_g=3.5, tilt_deg=70.0, lying_seconds=12.0),
    "normal": Thresholds(),
    "high": Thresholds(impact_g=1.8, tilt_deg=50.0, lying_seconds=5.0),
}
