const POLL_MS = 200;
const HISTORY_EVERY_MS = 10000;
const CHART_POINTS = 150;
const CHART_MAX_G = 5;
const CHART_HEIGHT = 50;
const DONUT_LENGTH = 2 * Math.PI * 48;
const IMPACT_LINE_G = { low: 3.5, normal: 2.5, high: 1.8 };
const RISK_WARN_PERCENT = 40;
const RISK_DANGER_PERCENT = 70;
const MAX_LOG_ROWS = 300;
const RECALIBRATE_MESSAGE =
  "ล็อกท่ายืนใหม่?\nให้พนักงานยืนตรงและนิ่งก่อนกดตกลง " +
  "ระบบจะหยุดตรวจจับการล้มชั่วคราวจนล็อกเสร็จ (ประมาณ 2 วินาที)";

const STATES = {
  NORMAL:      { key: "ok",        text: "ปกติ" },
  CHECKING:    { key: "checking",  text: "ตรวจพบแรงกระแทก กำลังตรวจสอบ…" },
  FALL:        { key: "fall",      text: "พนักงานล้ม! โปรดตรวจสอบทันที" },
  CALIBRATING: { key: "no-signal", text: "กำลังล็อกท่ายืนตรง… ให้ยืนตรงและนิ่งสักครู่" },
  NO_SIGNAL:   { key: "no-signal", text: "ไม่มีสัญญาณจากเซนเซอร์" },
  OFFLINE:     { key: "no-signal", text: "ขาดการเชื่อมต่อกับบอร์ด" },
};

const LINKS = {
  online:   { level: "ok",       text: "เชื่อมต่อแล้ว" },
  nosensor: { level: "checking", text: "บอร์ดต่อได้ แต่ไม่มีสัญญาณเซนเซอร์" },
  offline:  { level: "fall",     text: "ขาดการเชื่อมต่อ" },
};

const KIND_TEXT = { IMPACT_FALL: "ล้มจากแรงกระแทก", LYING_STILL: "นอนนิ่งผิดปกติ" };

const $ = (id) => document.getElementById(id);
const mannequin = new Mannequin($("figure-canvas"));

let chartData = [];
let currentPreset = "normal";
let archive = null;

async function getJson(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`${path} -> ${response.status}`);
  return response.json();
}

async function post(path) {
  await fetch(path, { method: "POST" });
}

function render(status) {
  const online = status !== null;
  const hasSignal = online && status.connected;
  const stateName = !online ? "OFFLINE" : !hasSignal ? "NO_SIGNAL" : status.state;
  const look = STATES[stateName];
  const live = hasSignal ? status : null;

  document.body.dataset.state = look.key;
  $("alert-text").textContent = look.text;
  $("ack-button").disabled = !(online && status.alarm);
  renderConnection(online ? (hasSignal ? "online" : "nosensor") : "offline");

  renderSensor(live);
  renderFigure(live, look.key);
  if (live) addChartPoint(live.peak_recent);

  if (online) {
    currentPreset = status.preset;
    $("next-log").textContent = status.seconds_to_next_log;
    renderPresets();
    renderRisk(live ? live.risk : null);
    renderSummary(status);
  }
}

function renderConnection(linkName) {
  const link = LINKS[linkName];
  $("conn-box").dataset.level = link.level;
  $("conn-text").textContent = link.text;
}

function renderFigure(live, lookKey) {
  mannequin.setLook(lookKey);
  if (!live) {
    $("pose-readout").textContent = "ไม่มีข้อมูลท่าทาง";
    return;
  }
  mannequin.setPose({
    forward: live.forward, side: live.side, tilt: live.tilt, isFall: live.state === "FALL",
  });
  $("pose-readout").textContent =
    `เอียงหน้า ${fixed(live.forward, 0)}° · เอียงข้าง ${fixed(live.side, 0)}° · ลำตัว ${fixed(live.tilt, 0)}°`;
}

function renderSensor(live) {
  const show = (id, value, digits) => {
    $(id).textContent = live ? fixed(value, digits) : "-";
  };
  show("m-g", live?.magnitude, 2);
  show("m-tilt", live?.tilt, 0);
  show("m-forward", live?.forward, 0);
  show("m-side", live?.side, 0);
  show("raw-x", live?.x, 2);
  show("raw-y", live?.y, 2);
  show("raw-z", live?.z, 2);
  $("axis-hint").textContent = live ? describeStanding(live) : "ไม่มีสัญญาณ";
  $("recalibrate").hidden = !(live && !live.manual_lock);
}

function describeStanding(status) {
  if (!status.calibrated) return "รอท่ายืนนิ่ง ๆ เพื่อล็อกท่ายืน…";
  const how = status.manual_lock ? "ตั้งเองใน app_config" : "ล็อกอัตโนมัติ";
  return `ล็อกท่ายืนแล้ว (${how}) · แกน ${status.standing_axis} ชี้ขึ้น`;
}

function addChartPoint(peakG) {
  chartData.push(peakG);
  if (chartData.length > CHART_POINTS) chartData.shift();

  const toY = (g) => CHART_HEIGHT - (Math.min(g, CHART_MAX_G) / CHART_MAX_G) * CHART_HEIGHT;
  $("chart-line").setAttribute("points", chartData.map((g, i) => `${i},${toY(g)}`).join(" "));

  const limitY = toY(IMPACT_LINE_G[currentPreset]);
  $("chart-limit").setAttribute("y1", limitY);
  $("chart-limit").setAttribute("y2", limitY);
}

function renderPresets() {
  document.querySelectorAll(".presets button").forEach((button) => {
    button.classList.toggle("active", button.dataset.preset === currentPreset);
  });
}

function renderRisk(risk) {
  const known = risk !== null;
  $("risk-value").textContent = known ? `${risk}%` : "-";
  $("risk-bar").style.width = known ? `${risk}%` : "0%";
  $("risk-card").dataset.level =
    !known || risk < RISK_WARN_PERCENT ? "ok" : risk < RISK_DANGER_PERCENT ? "warn" : "danger";
}

function renderSummary(status) {
  const { active_seconds: active, still_seconds: still, alert_seconds: alert } = status;

  $("work-time").textContent = hms(status.working_seconds);
  $("still-time").textContent = hms(still);
  $("still-share").textContent = status.working_seconds
    ? `${Math.round((still / status.working_seconds) * 100)}% ของเวลาทำงาน`
    : "-";

  $("lg-active").textContent = hms(active);
  $("lg-still").textContent = hms(still);
  $("lg-alert").textContent = hms(alert);
  $("donut-value").textContent = status.working_seconds
    ? `${Math.round((active / status.working_seconds) * 100)}%`
    : "-";

  drawDonut([["seg-active", active], ["seg-still", still], ["seg-alert", alert]]);
}

function drawDonut(segments) {
  const total = segments.reduce((sum, [, seconds]) => sum + seconds, 0);
  let offset = 0;
  for (const [className, seconds] of segments) {
    const length = total ? (seconds / total) * DONUT_LENGTH : 0;
    const circle = document.querySelector("." + className);
    circle.style.strokeDasharray = `${length} ${DONUT_LENGTH - length}`;
    circle.style.strokeDashoffset = -offset;
    offset += length;
  }
}

function toLogRows(data) {
  const events = data.events.map((e) => ({
    ts: e.ts, isEvent: true, kind: KIND_TEXT[e.kind] || e.kind,
    detail: `แรงสูงสุด ${e.peak_g} g · เอียง ${e.tilt}°`,
  }));
  const logs = data.logs.map((r) => ({
    ts: r.ts, isEvent: false, kind: "สรุป 5 นาที",
    detail: r.status === "NO_SIGNAL"
      ? "ไม่มีสัญญาณจากเซนเซอร์"
      : `เฉลี่ย ${r.avg_g} g · สูงสุด ${r.max_g} g · เอียงสูงสุด ${r.max_tilt}° · ล้ม ${r.fall_count} ครั้ง`,
  }));
  return [...events, ...logs].sort((a, b) => (a.ts < b.ts ? 1 : -1));
}

function fillLogList(listElement, rows, showDate) {
  listElement.replaceChildren();
  if (rows.length === 0) {
    const empty = document.createElement("li");
    empty.className = "log-empty";
    empty.textContent = "ยังไม่มีบันทึก (รอครบรอบ 5 นาทีครั้งแรก)";
    listElement.append(empty);
    return;
  }
  for (const row of rows.slice(0, MAX_LOG_ROWS)) {
    const item = document.createElement("li");
    item.className = "log-item" + (row.isEvent ? " event" : "");

    const time = document.createElement("time");
    time.textContent = showDate ? `${row.ts.slice(5, 10)} ${row.ts.slice(11, 16)}` : row.ts.slice(11, 19);
    const kind = document.createElement("span");
    kind.className = "log-kind";
    kind.textContent = (row.isEvent ? "🚨 " : "") + row.kind;
    const detail = document.createElement("span");
    detail.className = "log-detail";
    detail.textContent = row.detail;

    item.append(time, kind, detail);
    listElement.append(item);
  }
}

async function loadLiveLog() {
  try {
    fillLogList($("log-live"), toLogRows(await getJson("/api/history")), false);
  } catch (error) {
    console.error("โหลด Log ไม่สำเร็จ", error);
  }
}

async function loadArchive() {
  try {
    archive = await getJson("/api/export");
    renderArchive();
  } catch (error) {
    console.error("โหลดข้อมูลย้อนหลังไม่สำเร็จ", error);
  }
}

function renderArchive() {
  if (!archive) return;
  const day = $("history-date").value;
  const rows = toLogRows(archive).filter((row) => !day || row.ts.startsWith(day));
  fillLogList($("history-list"), rows, true);
}

async function exportCsv() {
  try {
    archive = await getJson("/api/export");
  } catch (error) {
    window.alert("ดาวน์โหลดไม่สำเร็จ: อ่านข้อมูลจากบอร์ดไม่ได้");
    return;
  }
  const blob = new Blob([buildCsv(archive)], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `worker-safety-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}

function buildCsv(data) {
  const header = ["type", "ts", "samples", "avg_g", "max_g", "avg_tilt", "max_tilt",
                  "fall_count", "status", "kind", "peak_g", "tilt"];
  const lines = [csvLine(header)];
  data.logs.forEach((r) => lines.push(csvLine(
    ["LOG", r.ts, r.samples, r.avg_g, r.max_g, r.avg_tilt, r.max_tilt, r.fall_count, r.status, "", "", ""])));
  data.events.forEach((e) => lines.push(csvLine(
    ["EVENT", e.ts, "", "", "", "", "", "", "", e.kind, e.peak_g, e.tilt])));
  return "﻿" + lines.join("\r\n");
}

function csvLine(values) {
  return values
    .map((v) => (v === null || v === undefined ? "" : `"${String(v).replace(/"/g, '""')}"`))
    .join(",");
}

function selectTab(name) {
  document.querySelectorAll("[data-tab]").forEach((button) => {
    button.classList.toggle("active", button.dataset.tab === name);
  });
  $("log-live").hidden = name !== "live";
  $("log-history").hidden = name !== "history";
  if (name === "history") loadArchive();
}

const fixed = (value, digits) => Number(value).toFixed(digits);

function hms(totalSeconds) {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(Math.floor(seconds / 3600))}:${pad(Math.floor((seconds % 3600) / 60))}:${pad(seconds % 60)}`;
}

async function pollStatus() {
  try {
    render(await getJson("/api/status"));
  } catch (error) {
    render(null);
  }
}

$("ack-button").addEventListener("click", async () => { await post("/api/ack"); pollStatus(); });
$("csv-button").addEventListener("click", exportCsv);
$("recalibrate").addEventListener("click", async () => {
  if (!window.confirm(RECALIBRATE_MESSAGE)) return;
  await post("/api/recalibrate");
  pollStatus();
});
$("history-date").addEventListener("change", renderArchive);
$("history-all").addEventListener("click", () => { $("history-date").value = ""; renderArchive(); });

document.querySelectorAll("[data-tab]").forEach((button) => {
  button.addEventListener("click", () => selectTab(button.dataset.tab));
});
document.querySelectorAll(".presets button").forEach((button) => {
  button.addEventListener("click", async () => {
    await post("/api/preset_" + button.dataset.preset);
    pollStatus();
  });
});

$("host-ip").textContent = location.hostname || "-";
setInterval(() => {
  $("clock").textContent = new Date().toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "medium" });
}, 1000);
setInterval(pollStatus, POLL_MS);
setInterval(loadLiveLog, HISTORY_EVERY_MS);
pollStatus();
loadLiveLog();
