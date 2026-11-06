import json
import math

import app_config

AXIS_NAMES = "xyz"

def _unit(axis_name: str, sign: int) -> tuple:
    vector = [0, 0, 0]
    vector[AXIS_NAMES.index(axis_name)] = sign
    return tuple(vector)

def _dot(a, b) -> float:
    return sum(p * q for p, q in zip(a, b))

def _cross(a, b) -> tuple:
    return (a[1] * b[2] - a[2] * b[1],
            a[2] * b[0] - a[0] * b[2],
            a[0] * b[1] - a[1] * b[0])

class BodyFrame:
    def __init__(self, up: tuple):
        self.up = _unit(*up)
        self.front = _unit(*app_config.FRONT_AXIS)
        self.right = _cross(self.up, self.front)
        if not any(self.right):
            raise ValueError("แกน 'ขึ้น' กับแกน 'หน้า' ต้องไม่ใช่แกนเดียวกัน")

    def angles(self, x: float, y: float, z: float):
        magnitude = math.sqrt(x * x + y * y + z * z)
        if magnitude < 0.05:
            return None
        reading = (x, y, z)
        up = _dot(reading, self.up)
        front = _dot(reading, self.front)
        right = _dot(reading, self.right)
        tilt = math.degrees(math.acos(max(-1.0, min(1.0, up / magnitude))))
        return tilt, math.degrees(math.atan2(-front, up)), math.degrees(math.atan2(-right, up))

class StandingLock:
    def __init__(self):
        self.up = app_config.MANUAL_UP or self._load()
        self._candidate = None
        self._candidate_since = None

    @property
    def locked(self) -> bool:
        return self.up is not None

    @property
    def is_manual(self) -> bool:
        return app_config.MANUAL_UP is not None

    @property
    def label(self) -> str | None:
        if not self.up:
            return None
        name, sign = self.up
        return ("+" if sign > 0 else "−") + name.upper()

    def frame(self) -> BodyFrame | None:
        return BodyFrame(self.up) if self.up else None

    def feed(self, x: float, y: float, z: float, now: float) -> None:
        candidate = self._find_candidate(x, y, z)
        if candidate is None or candidate != self._candidate:
            self._candidate = candidate
            self._candidate_since = now if candidate else None
            return
        if now - self._candidate_since >= app_config.LOCK_STILL_SECONDS:
            self.up = candidate
            self._save()

    def reset(self) -> bool:
        if self.is_manual:
            return False
        self.up = None
        self._candidate = None
        self._candidate_since = None
        app_config.STANDING_LOCK_FILE.unlink(missing_ok=True)
        return True

    @staticmethod
    def _find_candidate(x: float, y: float, z: float):
        magnitude = math.sqrt(x * x + y * y + z * z)
        if not 0.9 <= magnitude <= 1.1:
            return None
        for name, value in (("x", x), ("y", y)):
            if abs(value) >= app_config.LOCK_MIN_G:
                return (name, 1 if value > 0 else -1)
        return None

    @staticmethod
    def _load():
        try:
            data = json.loads(app_config.STANDING_LOCK_FILE.read_text())
            axis, sign = data["axis"], int(data["sign"])
            return (axis, sign) if axis in AXIS_NAMES and sign in (-1, 1) else None
        except (OSError, ValueError, KeyError, TypeError):
            return None

    def _save(self) -> None:
        name, sign = self.up
        app_config.STANDING_LOCK_FILE.parent.mkdir(parents=True, exist_ok=True)
        app_config.STANDING_LOCK_FILE.write_text(json.dumps({"axis": name, "sign": sign}))
