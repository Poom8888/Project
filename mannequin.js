const PALETTES = {
  "ok":        { head: "#bcd8ff", torso: "#a3c5fa", arm: "#6c9bf0", leg: "#4d82e4", foot: "#3a68c9", glow: "96, 165, 250" },
  "checking":  { head: "#ffe3a3", torso: "#fcd26b", arm: "#e8a93a", leg: "#cf8c1f", foot: "#a96d10", glow: "251, 191, 36" },
  "fall":      { head: "#ffc4c4", torso: "#fb9a9a", arm: "#ea6767", leg: "#d24848", foot: "#a93333", glow: "248, 113, 113" },
  "no-signal": { head: "#cfd4dc", torso: "#b3bac5", arm: "#8b93a1", leg: "#737c8b", foot: "#5e6674", glow: "139, 148, 163" },
};

const BODY = {
  hipY: 92, shoulderY: 146, headY: 172,
  hipX: 10, shoulderX: 21,
  headRadius: 15, torsoRadius: 17, armRadius: 5.5, legRadius: 8.5, footRadius: 5.5,
};

const DEFAULT_YAW = -62;
const CAMERA_TILT = 16;
const CAMERA_DISTANCE = 520;
const CENTER_Y = 95;
const FLOOR = { half: 240, step: 40 };
const EDGE_MARGIN = 28;
const SCENE_SIZE = { width: 330, height: 262 };
const FIGURE_SCREEN_Y = 0.46;
const CENTERING_STRENGTH = 0.8;
const GLOW_RADIUS = 95;
const GLOW_SQUASH = 0.32;

const POSE_LIMIT_DEG = 100;
const LEG_FOLLOW_FROM_DEG = 40;
const LEG_FOLLOW_RANGE_DEG = 50;
const SMOOTHING_SPEED = 10;
const DRAG_DEGREES_PER_PIXEL = 0.5;

const rad = (degrees) => (degrees * Math.PI) / 180;
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

function rotateBody([x, y, z], forwardDeg, sideDeg) {
  const f = rad(forwardDeg);
  const s = rad(sideDeg);

  const y1 = y * Math.cos(f) - z * Math.sin(f);
  const z1 = y * Math.sin(f) + z * Math.cos(f);

  return [x * Math.cos(s) + y1 * Math.sin(s), -x * Math.sin(s) + y1 * Math.cos(s), z1];
}

const capsule = (from, to, radius, color) => ({ kind: "capsule", from, to, radius, color });

function buildFigure(pose, palette) {
  const hipLocal = [0, BODY.hipY, 0];

  const turnLegs = (p) => rotateBody(p, pose.forward * pose.legFollow, pose.side * pose.legFollow);
  const hip = turnLegs(hipLocal);

  const turnTorso = (p) => {
    const offset = [p[0] - hipLocal[0], p[1] - hipLocal[1], p[2] - hipLocal[2]];
    const turned = rotateBody(offset, pose.forward, pose.side);
    return [hip[0] + turned[0], hip[1] + turned[1], hip[2] + turned[2]];
  };

  const parts = [];

  for (const leftRight of [-1, 1]) {
    const legX = leftRight * BODY.hipX;
    parts.push(capsule(turnLegs([legX, BODY.hipY, 0]), turnLegs([legX, 8, 0]), BODY.legRadius, palette.leg));
    parts.push(capsule(turnLegs([legX, 5, 0]), turnLegs([legX, 5, 15]), BODY.footRadius, palette.foot));

    const shoulderX = leftRight * BODY.shoulderX;
    parts.push(capsule(
      turnTorso([shoulderX, BODY.shoulderY, 0]),
      turnTorso([shoulderX + leftRight * 2, BODY.hipY - 6, 5]),
      BODY.armRadius, palette.arm));
  }

  parts.push(capsule(turnTorso(hipLocal), turnTorso([0, BODY.shoulderY - 4, 0]),
                     BODY.torsoRadius, palette.torso));
  parts.push(capsule(turnTorso([0, BODY.shoulderY, 0]), turnTorso([0, BODY.shoulderY + 12, 0]),
                     6, palette.torso));

  const headCenter = turnTorso([0, BODY.headY, 0]);
  parts.push({ kind: "sphere", center: headCenter, radius: BODY.headRadius, color: palette.head });

  const faceDot = turnTorso([0, BODY.headY + 2, BODY.headRadius - 1.5]);
  return { parts, headCenter, faceDot };
}

class Mannequin {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.yaw = DEFAULT_YAW;
    this.palette = PALETTES.ok;

    this.target = { forward: 0, side: 0, legFollow: 0 };
    this.pose = { ...this.target };
    this.lastFrameTime = performance.now();

    this.resize();
    new ResizeObserver(() => this.resize()).observe(canvas.parentElement);
    this.enableDragToRotate();
    requestAnimationFrame((time) => this.frame(time));
  }

  setPose({ forward, side, tilt, isFall }) {
    this.target.forward = clamp(forward, -POSE_LIMIT_DEG, POSE_LIMIT_DEG);
    this.target.side = clamp(side, -POSE_LIMIT_DEG, POSE_LIMIT_DEG);

    this.target.legFollow = isFall ? 1 : clamp((tilt - LEG_FOLLOW_FROM_DEG) / LEG_FOLLOW_RANGE_DEG, 0, 1);
  }

  setLook(stateKey) {
    this.palette = PALETTES[stateKey] || PALETTES["no-signal"];
  }

  resize() {
    const ratio = window.devicePixelRatio || 1;
    this.width = this.canvas.clientWidth;
    this.height = this.canvas.clientHeight;
    this.canvas.width = Math.round(this.width * ratio);
    this.canvas.height = Math.round(this.height * ratio);
    this.ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    this.scale = Math.min(this.height / SCENE_SIZE.height, this.width / SCENE_SIZE.width);
  }

  enableDragToRotate() {
    let dragging = false;
    let lastX = 0;

    this.canvas.addEventListener("pointerdown", (event) => {
      dragging = true;
      lastX = event.clientX;
      this.canvas.setPointerCapture(event.pointerId);
    });
    this.canvas.addEventListener("pointermove", (event) => {
      if (!dragging) return;
      this.yaw += (event.clientX - lastX) * DRAG_DEGREES_PER_PIXEL;
      lastX = event.clientX;
    });
    const stopDragging = () => { dragging = false; };
    this.canvas.addEventListener("pointerup", stopDragging);
    this.canvas.addEventListener("pointercancel", stopDragging);
    this.canvas.addEventListener("dblclick", () => { this.yaw = DEFAULT_YAW; });
  }

  frame(time) {
    const seconds = Math.min((time - this.lastFrameTime) / 1000, 0.1);
    this.lastFrameTime = time;

    const follow = 1 - Math.exp(-seconds * SMOOTHING_SPEED);
    for (const key of Object.keys(this.pose)) {
      this.pose[key] += (this.target[key] - this.pose[key]) * follow;
    }

    this.draw();
    requestAnimationFrame((next) => this.frame(next));
  }

  toCamera([x, y, z]) {
    const yaw = rad(this.yaw);
    const tilt = rad(CAMERA_TILT);
    const x1 = x * Math.cos(yaw) + z * Math.sin(yaw);
    const z1 = -x * Math.sin(yaw) + z * Math.cos(yaw);
    return [x1, y * Math.cos(tilt) - z1 * Math.sin(tilt), y * Math.sin(tilt) + z1 * Math.cos(tilt)];
  }

  project(point) {
    const [x, y, depth] = this.toCamera(point);
    const k = this.scale * CAMERA_DISTANCE / (CAMERA_DISTANCE - depth);
    return { x: this.width / 2 + x * k, y: this.height * FIGURE_SCREEN_Y - (y - CENTER_Y) * k, k, depth };
  }

  draw() {
    const figure = buildFigure(this.pose, this.palette);
    const shapes = figure.parts.map((part) => this.toScreenShape(part));
    const offset = this.fitOffset(shapes);

    this.ctx.clearRect(0, 0, this.width, this.height);
    this.ctx.save();
    this.ctx.translate(offset.x, offset.y);
    this.drawFloor();
    this.drawGlow();
    shapes.sort((a, b) => a.depth - b.depth);
    shapes.forEach((shape) => this.drawShape(shape));
    this.drawFaceDot(figure);
    this.ctx.restore();
  }

  fitOffset(shapes) {
    let minX = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const shape of shapes) {
      const ends = shape.kind === "sphere" ? [shape.center] : [shape.from, shape.to];
      for (const end of ends) {
        const pad = shape.radius * end.k;
        minX = Math.min(minX, end.x - pad);
        maxX = Math.max(maxX, end.x + pad);
        maxY = Math.max(maxY, end.y + pad);
      }
    }
    return {
      x: (this.width / 2 - (minX + maxX) / 2) * CENTERING_STRENGTH,
      y: Math.min(0, this.height - EDGE_MARGIN - maxY),
    };
  }

  toScreenShape(part) {
    if (part.kind === "sphere") {
      const center = this.project(part.center);
      return { ...part, center, depth: center.depth };
    }
    const from = this.project(part.from);
    const to = this.project(part.to);
    return { ...part, from, to, depth: (from.depth + to.depth) / 2 };
  }

  drawShape(shape) {
    const ctx = this.ctx;
    ctx.fillStyle = shape.color;
    ctx.strokeStyle = shape.color;

    if (shape.kind === "sphere") {
      ctx.beginPath();
      ctx.arc(shape.center.x, shape.center.y, shape.radius * shape.center.k, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    ctx.lineCap = "round";
    ctx.lineWidth = 2 * shape.radius * (shape.from.k + shape.to.k) / 2;
    ctx.beginPath();
    ctx.moveTo(shape.from.x, shape.from.y);
    ctx.lineTo(shape.to.x, shape.to.y);
    ctx.stroke();
  }

  drawFaceDot({ headCenter, faceDot }) {
    const head = this.project(headCenter);
    const dot = this.project(faceDot);
    if (dot.depth <= head.depth) return;
    this.ctx.fillStyle = "#1c2742";
    this.ctx.beginPath();
    this.ctx.arc(dot.x, dot.y, 2.6 * dot.k, 0, Math.PI * 2);
    this.ctx.fill();
  }

  drawFloor() {
    const ctx = this.ctx;
    ctx.lineWidth = 1;
    for (let offset = -FLOOR.half; offset <= FLOOR.half; offset += FLOOR.step) {
      ctx.strokeStyle = offset === 0 ? "rgba(255,255,255,0.20)" : "rgba(255,255,255,0.09)";
      this.line([-FLOOR.half, 0, offset], [FLOOR.half, 0, offset]);
      this.line([offset, 0, -FLOOR.half], [offset, 0, FLOOR.half]);
    }
  }

  line(from, to) {
    const a = this.project(from);
    const b = this.project(to);
    this.ctx.beginPath();
    this.ctx.moveTo(a.x, a.y);
    this.ctx.lineTo(b.x, b.y);
    this.ctx.stroke();
  }

  drawGlow() {
    const ctx = this.ctx;
    const feet = this.project([0, 0, 0]);
    const radius = GLOW_RADIUS * feet.k;
    const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, radius);
    gradient.addColorStop(0, `rgba(${this.palette.glow}, 0.30)`);
    gradient.addColorStop(1, `rgba(${this.palette.glow}, 0)`);

    ctx.save();
    ctx.translate(feet.x, feet.y);
    ctx.scale(1, GLOW_SQUASH);
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}
