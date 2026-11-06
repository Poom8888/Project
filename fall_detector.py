from collections import deque
from dataclasses import dataclass
import math

from app_config import Thresholds
from posture import BodyFrame

NORMAL = "NORMAL"
CHECKING = "CHECKING"
FALL = "FALL"

WINDOW_SECONDS = 1.0
UPRIGHT_DEG = 30.0
RECOVER_SECONDS = 5.0

@dataclass
class Reading:

    magnitude: float
    tilt: float
    forward: float
    side: float
    state: str
    event: str | None
    peak_g: float
    still: bool

def risk_percent(state: str, magnitude: float, tilt: float, thresholds: Thresholds) -> int:
    if state == FALL:
        return 100
    if state == CHECKING:
        return 90
    tilt_ratio = tilt / thresholds.tilt_deg
    jerk_ratio = abs(magnitude - 1.0) / (thresholds.impact_g - 1.0)
    return int(round(min(max(tilt_ratio, jerk_ratio), 1.0) * 80))

class FallDetector:
    def __init__(self, thresholds: Thresholds, frame: BodyFrame | None = None):
        self.thresholds = thresholds
        self.frame = frame
        self.state = NORMAL
        self.peak_g = 0.0
        self._recent: deque = deque()
        self._impact_time = None
        self._lying_since = None
        self._upright_since = None
        self._last_tilt = 0.0
        self._last_forward = 0.0
        self._last_side = 0.0

    def set_thresholds(self, thresholds: Thresholds) -> None:
        self.thresholds = thresholds

    def set_frame(self, frame: BodyFrame | None) -> None:
        self.frame = frame
        self.acknowledge()
        self._recent.clear()
        self._last_tilt = self._last_forward = self._last_side = 0.0

    def acknowledge(self) -> None:
        self.state = NORMAL
        self._impact_time = None
        self._lying_since = None
        self._upright_since = None

    def update(self, x: float, y: float, z: float, now: float) -> Reading:
        if self.frame is None:
            raise RuntimeError("ยังไม่ได้ล็อกท่ายืนตรง จึงยังตรวจจับไม่ได้")

        magnitude = math.sqrt(x * x + y * y + z * z)
        self._update_posture(x, y, z)
        self._remember(now, magnitude)

        lying = self._window_tilt() > self.thresholds.tilt_deg
        still = self._window_is_still()
        event = None

        if self.state == NORMAL:
            event = self._check_normal(now, magnitude, lying, still)
        elif self.state == CHECKING:
            event = self._check_after_impact(now, magnitude, lying, still)
        elif self.state == FALL:
            event = self._check_recovery(now)

        return Reading(magnitude, self._last_tilt, self._last_forward,
                       self._last_side, self.state, event, self.peak_g, still)

    def _update_posture(self, x, y, z) -> None:
        angles = self.frame.angles(x, y, z)
        if angles is None:
            return
        self._last_tilt, self._last_forward, self._last_side = angles

    def _remember(self, now: float, magnitude: float) -> None:
        self._recent.append((now, magnitude, self._last_tilt))
        while self._recent and now - self._recent[0][0] > WINDOW_SECONDS:
            self._recent.popleft()

    def _window_is_full(self) -> bool:
        return bool(self._recent) and \
            self._recent[-1][0] - self._recent[0][0] >= WINDOW_SECONDS * 0.9

    def _window_tilt(self) -> float:
        tilts = [t for _, _, t in self._recent]
        return sum(tilts) / len(tilts) if tilts else 0.0

    def _window_is_still(self) -> bool:
        if not self._window_is_full():
            return False
        values = [m for _, m, _ in self._recent]
        return (max(values) - min(values)) < self.thresholds.still_band_g

    def _check_normal(self, now, magnitude, lying, still):
        if magnitude >= self.thresholds.impact_g:
            self.state = CHECKING
            self._impact_time = now
            self.peak_g = magnitude
            return None
        if lying and still:
            if self._lying_since is None:
                self._lying_since = now
            if now - self._lying_since >= self.thresholds.lying_seconds:
                self.state = FALL
                self.peak_g = 0.0
                return "LYING_STILL"
        else:
            self._lying_since = None
        return None

    def _check_after_impact(self, now, magnitude, lying, still):
        self.peak_g = max(self.peak_g, magnitude)
        if now - self._impact_time < self.thresholds.confirm_seconds:
            return None
        if lying and still:
            self.state = FALL
            return "IMPACT_FALL"
        self.state = NORMAL
        return None

    def _check_recovery(self, now):
        if self._last_tilt < UPRIGHT_DEG:
            if self._upright_since is None:
                self._upright_since = now
            if now - self._upright_since >= RECOVER_SECONDS:
                self.acknowledge()
                return "RECOVERED"
        else:
            self._upright_since = None
        return None
