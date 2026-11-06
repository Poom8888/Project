import logging
import math
import threading
import time
from datetime import date

from arduino.app_bricks.web_ui import WebUI
from arduino.app_utils import App, Bridge

import app_config
import storage
from fall_detector import FALL, FallDetector, risk_percent
from posture import StandingLock

logger = logging.getLogger("worker-safety")

lock = threading.Lock()
standing_lock = StandingLock()
detector = FallDetector(app_config.PRESETS["normal"], standing_lock.frame())
window_stats = storage.WindowStats()

latest = {
    "magnitude": 0.0, "tilt": 0.0, "forward": 0.0, "side": 0.0,
    "state": "NORMAL", "peak_g": 0.0,
    "x": 0.0, "y": 0.0, "z": 0.0,
    "risk": 0,
}
last_sample_time = 0.0
peak_since_poll = 0.0
preset_name = "normal"
alarm_wanted = False
alarm_sent = False
last_log_time = time.monotonic()

MAX_GAP_SECONDS = 1.0
STATUS_DECIMALS = 2
usage = {"active": 0.0, "still": 0.0, "alert": 0.0}
usage_day = date.today()

def _calibrate(x: float, y: float, z: float, now: float) -> None:
    global last_sample_time
    standing_lock.feed(x, y, z, now)
    if standing_lock.locked:
        detector.set_frame(standing_lock.frame())
        logger.info("ล็อกท่ายืนตรงแล้ว: แกน %s ชี้ขึ้น", standing_lock.label)

    latest.update(magnitude=math.sqrt(x * x + y * y + z * z), tilt=0.0, forward=0.0,
                  side=0.0, state="CALIBRATING", peak_g=0.0, x=x, y=y, z=z, risk=0)
    last_sample_time = now

def _restart_usage_on_new_day() -> None:
    global usage_day
    if date.today() != usage_day:
        usage.update(active=0.0, still=0.0, alert=0.0)
        usage_day = date.today()

def _count_usage(now: float, reading) -> None:
    _restart_usage_on_new_day()

    elapsed = now - last_sample_time
    if last_sample_time == 0.0 or elapsed > MAX_GAP_SECONDS:
        return

    if reading.state != "NORMAL":
        usage["alert"] += elapsed
    elif reading.still:
        usage["still"] += elapsed
    else:
        usage["active"] += elapsed

def on_sample(x: float, y: float, z: float) -> None:
    global last_sample_time, peak_since_poll, alarm_wanted

    now = time.monotonic()
    with lock:
        if not standing_lock.locked:
            _calibrate(x, y, z, now)
            return

        reading = detector.update(x, y, z, now)
        _count_usage(now, reading)

        latest.update(magnitude=reading.magnitude, tilt=reading.tilt,
                      forward=reading.forward, side=reading.side,
                      state=reading.state, peak_g=reading.peak_g, x=x, y=y, z=z,
                      risk=risk_percent(reading.state, reading.magnitude,
                                        reading.tilt, detector.thresholds))
        last_sample_time = now
        peak_since_poll = max(peak_since_poll, reading.magnitude)
        window_stats.add(reading.magnitude, reading.tilt, reading.state)

        if reading.event in ("IMPACT_FALL", "LYING_STILL"):
            window_stats.count_fall()
            alarm_wanted = True
            storage.save_fall_event(reading.event, reading.peak_g, reading.tilt)
            logger.warning("ตรวจพบการล้ม: %s (peak %.2f g, tilt %.0f°)",
                           reading.event, reading.peak_g, reading.tilt)
        elif reading.event == "RECOVERED":
            alarm_wanted = False
            logger.info("พนักงานกลับมายืนตรงแล้ว")

def api_status() -> dict:
    global peak_since_poll
    with lock:
        now = time.monotonic()
        connected = (now - last_sample_time) < app_config.SIGNAL_TIMEOUT_SECONDS
        status = dict(latest)
        status["peak_recent"] = round(peak_since_poll, 3)
        peak_since_poll = 0.0
        status["connected"] = connected
        status["alarm"] = alarm_wanted
        status["preset"] = preset_name
        status["calibrated"] = standing_lock.locked
        status["standing_axis"] = standing_lock.label
        status["manual_lock"] = standing_lock.is_manual
        status["active_seconds"] = int(usage["active"])
        status["still_seconds"] = int(usage["still"])
        status["alert_seconds"] = int(usage["alert"])
        status["working_seconds"] = (status["active_seconds"] + status["still_seconds"]
                                     + status["alert_seconds"])
        status["seconds_to_next_log"] = max(
            0, int(app_config.LOG_INTERVAL_SECONDS - (now - last_log_time)))
    for key in ("magnitude", "tilt", "forward", "side", "peak_g", "x", "y", "z"):
        status[key] = round(status[key], STATUS_DECIMALS)
    return status

def api_history() -> dict:
    return {"logs": storage.read_recent_logs(), "events": storage.read_recent_events()}

def api_export() -> dict:
    return {"logs": storage.read_all_logs(), "events": storage.read_all_events()}

def api_acknowledge() -> dict:
    global alarm_wanted
    with lock:
        detector.acknowledge()
        latest["state"] = "NORMAL"
        alarm_wanted = False
    return {"ok": True}

def api_recalibrate() -> dict:
    global alarm_wanted
    with lock:
        if standing_lock.reset():
            detector.set_frame(None)
            alarm_wanted = False
            logger.info("ล้างท่ายืนตรง รอล็อกใหม่")
    return {"ok": True}

def _apply_preset(name: str) -> dict:
    global preset_name
    with lock:
        detector.set_thresholds(app_config.PRESETS[name])
        preset_name = name
    logger.info("เปลี่ยนความไวเป็น %s", name)
    return {"ok": True, "preset": name}

def api_preset_low() -> dict:
    return _apply_preset("low")

def api_preset_normal() -> dict:
    return _apply_preset("normal")

def api_preset_high() -> dict:
    return _apply_preset("high")

def register_api(ui: WebUI) -> None:
    ui.expose_api("GET", "/api/status", api_status)
    ui.expose_api("GET", "/api/history", api_history)
    ui.expose_api("GET", "/api/export", api_export)
    ui.expose_api("POST", "/api/ack", api_acknowledge)
    ui.expose_api("POST", "/api/recalibrate", api_recalibrate)
    ui.expose_api("POST", "/api/preset_low", api_preset_low)
    ui.expose_api("POST", "/api/preset_normal", api_preset_normal)
    ui.expose_api("POST", "/api/preset_high", api_preset_high)

def sync_buzzer() -> None:
    global alarm_sent
    with lock:
        wanted = alarm_wanted
    if wanted != alarm_sent:
        try:
            Bridge.call("set_alarm", 1 if wanted else 0)
            alarm_sent = wanted
        except Exception as error:
            logger.error("สั่ง Buzzer ไม่สำเร็จ: %s", error)

def save_log_if_due() -> None:
    global last_log_time
    if time.monotonic() - last_log_time < app_config.LOG_INTERVAL_SECONDS:
        return
    with lock:
        window_stats.save_and_reset()
        last_log_time = time.monotonic()
    logger.info("บันทึกสรุปรอบ 5 นาทีลงฐานข้อมูลแล้ว")

def background_loop() -> None:
    sync_buzzer()
    save_log_if_due()
    time.sleep(0.2)

logging.basicConfig(level=logging.INFO)
storage.init_database()

Bridge.provide("record_sensor_movement", on_sample)
web_ui = WebUI()
register_api(web_ui)

App.run(user_loop=background_loop)
