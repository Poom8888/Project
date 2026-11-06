import sqlite3
from contextlib import closing
from datetime import datetime

import app_config

def _now_text() -> str:
    return datetime.now().astimezone().isoformat(timespec="seconds")

def _connect() -> sqlite3.Connection:
    app_config.DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    return sqlite3.connect(app_config.DB_PATH)

def init_database() -> None:
    with closing(_connect()) as db:
        db.execute("""
            CREATE TABLE IF NOT EXISTS sensor_log (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                ts          TEXT    NOT NULL,
                samples     INTEGER NOT NULL,
                avg_g       REAL,
                max_g       REAL,
                avg_tilt    REAL,
                max_tilt    REAL,
                fall_count  INTEGER NOT NULL,
                status      TEXT    NOT NULL
            )""")
        db.execute("""
            CREATE TABLE IF NOT EXISTS fall_events (
                id      INTEGER PRIMARY KEY AUTOINCREMENT,
                ts      TEXT NOT NULL,
                kind    TEXT NOT NULL,
                peak_g  REAL,
                tilt    REAL
            )""")
        db.commit()

class WindowStats:

    def __init__(self):
        self.reset()

    def reset(self) -> None:
        self.samples = 0
        self.sum_g = 0.0
        self.max_g = 0.0
        self.sum_tilt = 0.0
        self.max_tilt = 0.0
        self.fall_count = 0
        self.last_state = "NORMAL"

    def add(self, magnitude: float, tilt: float, state: str) -> None:
        self.samples += 1
        self.sum_g += magnitude
        self.max_g = max(self.max_g, magnitude)
        self.sum_tilt += tilt
        self.max_tilt = max(self.max_tilt, tilt)
        self.last_state = state

    def count_fall(self) -> None:
        self.fall_count += 1

    def save_and_reset(self) -> None:
        if self.samples == 0:
            row = (_now_text(), 0, None, None, None, None, self.fall_count, "NO_SIGNAL")
        else:
            row = (_now_text(), self.samples,
                   round(self.sum_g / self.samples, 3), round(self.max_g, 3),
                   round(self.sum_tilt / self.samples, 1), round(self.max_tilt, 1),
                   self.fall_count, self.last_state)
        with closing(_connect()) as db:
            db.execute("""INSERT INTO sensor_log
                (ts, samples, avg_g, max_g, avg_tilt, max_tilt, fall_count, status)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)""", row)
            db.commit()
        self.reset()

def save_fall_event(kind: str, peak_g: float, tilt: float) -> None:
    with closing(_connect()) as db:
        db.execute("INSERT INTO fall_events (ts, kind, peak_g, tilt) VALUES (?, ?, ?, ?)",
                   (_now_text(), kind, round(peak_g, 2), round(tilt, 1)))
        db.commit()

def read_recent_logs(limit: int = 12) -> list:
    return _read("""SELECT ts, samples, avg_g, max_g, avg_tilt, max_tilt, fall_count, status
                    FROM sensor_log ORDER BY id DESC LIMIT ?""", limit)

def read_recent_events(limit: int = 10) -> list:
    return _read("SELECT ts, kind, peak_g, tilt FROM fall_events ORDER BY id DESC LIMIT ?",
                 limit)

def read_all_logs(limit: int = 5000) -> list:
    return read_recent_logs(limit)

def read_all_events(limit: int = 2000) -> list:
    return read_recent_events(limit)

def _read(query: str, limit: int) -> list:
    with closing(_connect()) as db:
        db.row_factory = sqlite3.Row
        return [dict(row) for row in db.execute(query, (limit,))]
