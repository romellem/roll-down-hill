import type { Body, Polygon } from 'planck';
import {
  FULCRUM,
  GROUND_LABELS,
  STONE_RADIUS,
  TERRAIN_BLOCKS,
  TERRAIN_OUTLINE,
  VIEW,
  personHeadRadius,
  type Pt,
} from './scene.ts';
import type { Person, Simulation } from './sim.ts';

const INK = '#3a2e22';
const DEAD = '#a3271b';
const STONE_LIGHT = '#d8c7a3';
const STONE_DARK = '#9a8460';
const WOOD = '#c9a877';
const TRAIL = { boulder: '#8a5a2b', ball: '#3d6b8c' };

const VIEW_W = VIEW.x1 - VIEW.x0;
const VIEW_H = VIEW.y1 - VIEW.y0;
export const VIEW_ASPECT = VIEW_W / VIEW_H;

export class Renderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  /** CSS pixels per metre */
  private s = 1;
  private dpr = 1;
  private hatch: CanvasPattern | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.canvas.style.aspectRatio = `${VIEW_W} / ${VIEW_H}`;
    this.ctx = canvas.getContext('2d')!;
    this.resize();
  }

  resize() {
    const cssW = this.canvas.clientWidth || 900;
    this.dpr = Math.min(window.devicePixelRatio || 1, 3);
    this.s = cssW / VIEW_W;
    this.canvas.width = Math.round(cssW * this.dpr);
    this.canvas.height = Math.round((cssW / VIEW_ASPECT) * this.dpr);
    this.hatch = this.makeHatch();
  }

  /** Diagonal pen hatching, kept at a constant on-screen size. */
  private makeHatch(): CanvasPattern | null {
    const size = Math.round(7 * this.dpr);
    const tile = document.createElement('canvas');
    tile.width = tile.height = size;
    const t = tile.getContext('2d')!;
    t.strokeStyle = 'rgba(58,46,34,0.28)';
    t.lineWidth = 0.8 * this.dpr;
    t.beginPath();
    for (const o of [-size, 0, size]) {
      t.moveTo(o, size);
      t.lineTo(o + size, 0);
    }
    t.stroke();
    const pattern = this.ctx.createPattern(tile, 'repeat');
    pattern?.setTransform(new DOMMatrix().scale(1 / (this.s * this.dpr), -1 / (this.s * this.dpr)));
    return pattern;
  }

  /** Metres per CSS pixel, for line widths in world space. */
  private px(n: number) {
    return n / this.s;
  }

  private worldSpace() {
    const k = this.s * this.dpr;
    this.ctx.setTransform(k, 0, 0, -k, -VIEW.x0 * k, VIEW.y1 * k);
  }

  private screenSpace() {
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  private toScreen(p: Pt): Pt {
    return { x: (p.x - VIEW.x0) * this.s, y: (VIEW.y1 - p.y) * this.s };
  }

  draw(sim: Simulation, opts: { trails: boolean }) {
    const { ctx } = this;
    this.screenSpace();
    const cssW = this.canvas.width / this.dpr;
    const cssH = this.canvas.height / this.dpr;
    const bg = ctx.createRadialGradient(cssW / 2, cssH / 2, cssH * 0.2, cssW / 2, cssH / 2, cssW * 0.75);
    bg.addColorStop(0, '#f5ead2');
    bg.addColorStop(1, '#e4d2ab');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, cssW, cssH);

    this.worldSpace();
    if (opts.trails) this.drawTrails(sim);
    this.drawTerrain();
    this.drawFixedProps(sim);
    this.drawPlank(sim.plank);
    this.drawStone(sim.boulder);
    this.drawStone(sim.ball);
    for (const p of sim.people) this.drawPerson(p);

    this.screenSpace();
    this.drawGroundLabels();
    for (const p of sim.people) this.drawPersonTag(p);
    this.drawStoneLetter(sim.boulder, 'E');
    this.drawOffscreen(sim);
    this.drawClock(sim);
  }

  private path(pts: Pt[], close = true) {
    const { ctx } = this;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    if (close) ctx.closePath();
  }

  private drawTerrain() {
    const { ctx } = this;
    ctx.lineJoin = 'round';
    for (const block of TERRAIN_BLOCKS) {
      this.path(block);
      ctx.fillStyle = '#dcc8a0';
      ctx.fill();
      if (this.hatch) {
        ctx.fillStyle = this.hatch;
        ctx.fill();
      }
      ctx.strokeStyle = 'rgba(58,46,34,0.35)';
      ctx.lineWidth = this.px(1);
      ctx.stroke();
    }
    this.path(TERRAIN_OUTLINE);
    ctx.strokeStyle = INK;
    ctx.lineWidth = this.px(2.2);
    ctx.stroke();
  }

  private drawFixedProps(sim: Simulation) {
    const { ctx } = this;
    // fulcrum
    this.path(FULCRUM);
    ctx.fillStyle = '#cdb58a';
    ctx.fill();
    if (this.hatch) {
      ctx.fillStyle = this.hatch;
      ctx.fill();
    }
    ctx.strokeStyle = INK;
    ctx.lineWidth = this.px(1.6);
    ctx.stroke();

    // spikes (static bodies other than the ground)
    for (let b = sim.world.getBodyList(); b; b = b.getNext()) {
      if (!b.isStatic()) continue;
      for (let f = b.getFixtureList(); f; f = f.getNext()) {
        const tag = f.getUserData() as { kind: string } | undefined;
        if (tag?.kind !== 'spike') continue;
        this.path((f.getShape() as Polygon).m_vertices);
        ctx.fillStyle = '#4a3e31';
        ctx.fill();
        ctx.strokeStyle = INK;
        ctx.lineWidth = this.px(1);
        ctx.stroke();
      }
    }
  }

  private withBody(body: Body, fn: () => void) {
    const { ctx } = this;
    const p = body.getPosition();
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(body.getAngle());
    fn();
    ctx.restore();
  }

  private drawPlank(plank: Body) {
    const { ctx } = this;
    this.withBody(plank, () => {
      for (let f = plank.getFixtureList(); f; f = f.getNext()) {
        const tag = f.getUserData() as { kind: string };
        this.path((f.getShape() as Polygon).m_vertices);
        ctx.fillStyle = tag.kind === 'spike' ? '#4a3e31' : WOOD;
        ctx.fill();
        ctx.strokeStyle = INK;
        ctx.lineWidth = this.px(1.4);
        ctx.stroke();
      }
    });
  }

  private drawStone(body: Body) {
    const { ctx } = this;
    const r = STONE_RADIUS;
    this.withBody(body, () => {
      const g = ctx.createRadialGradient(-r * 0.35, r * 0.4, r * 0.1, 0, 0, r);
      g.addColorStop(0, STONE_LIGHT);
      g.addColorStop(1, STONE_DARK);
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fillStyle = g;
      ctx.fill();
      // a few cracks and pits so you can see it roll
      ctx.strokeStyle = 'rgba(58,46,34,0.55)';
      ctx.lineWidth = this.px(1.2);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(-0.55 * r, 0.45 * r);
      ctx.quadraticCurveTo(-0.25 * r, 0.25 * r, -0.3 * r, -0.05 * r);
      ctx.moveTo(0.35 * r, -0.6 * r);
      ctx.quadraticCurveTo(0.5 * r, -0.3 * r, 0.72 * r, -0.28 * r);
      ctx.moveTo(0.2 * r, 0.62 * r);
      ctx.lineTo(0.45 * r, 0.5 * r);
      ctx.stroke();
      ctx.fillStyle = 'rgba(58,46,34,0.35)';
      for (const [x, y] of [[-0.5, -0.45], [0.55, 0.2], [-0.1, -0.7], [0.1, 0.25]]) {
        ctx.beginPath();
        ctx.arc(x * r, y * r, this.px(1.6), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.strokeStyle = INK;
      ctx.lineWidth = this.px(2);
      ctx.stroke();
    });
  }

  private drawStoneLetter(body: Body, letter: string) {
    const { ctx } = this;
    const c = this.toScreen(body.getPosition());
    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.rotate(-body.getAngle());
    ctx.font = `600 ${Math.round(STONE_RADIUS * 0.9 * this.s)}px Georgia, 'Times New Roman', serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(245,234,210,0.85)';
    ctx.fillText(letter, 0, 0);
    ctx.lineWidth = Math.max(1, this.s * 0.025);
    ctx.strokeStyle = INK;
    ctx.strokeText(letter, 0, 0);
    ctx.restore();
  }

  private drawPerson(p: Person) {
    const { ctx } = this;
    const H = p.spec.height;
    const f = p.spec.facing;
    const hr = personHeadRadius(H);
    const color = p.alive ? INK : DEAD;
    // Pose key-points in units of height, "forward" = +x.
    const pose = POSES[p.pose];
    const P = (k: keyof PoseDef) => ({ x: pose[k][0] * H * f, y: pose[k][1] * H });

    this.withBody(p.body, () => {
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      const limb = (...pts: Pt[]) => {
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (const q of pts.slice(1)) ctx.lineTo(q.x, q.y);
        ctx.stroke();
      };
      ctx.lineWidth = 0.075 * H;
      limb(P('hip'), P('kneeB'), P('footB'));
      limb(P('shoulder'), P('elbowB'), P('handB'));
      ctx.lineWidth = 0.11 * H;
      limb(P('hip'), P('shoulder'));
      ctx.lineWidth = 0.075 * H;
      limb(P('hip'), P('kneeF'), P('footF'));
      limb(P('shoulder'), P('elbowF'), P('handF'));
      const head = P('head');
      ctx.beginPath();
      ctx.arc(head.x, head.y, hr, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  private drawPersonTag(p: Person) {
    const { ctx } = this;
    const body = p.body;
    const top = body.getWorldPoint({ x: 0, y: p.spec.height + 0.12 });
    const s = this.toScreen(top);
    const size = Math.max(11, Math.round(this.s * 0.36));
    ctx.font = `italic 600 ${size}px Georgia, 'Times New Roman', serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillStyle = p.alive ? INK : DEAD;
    ctx.fillText(p.alive ? p.spec.id : `${p.spec.id} ✕`, s.x, s.y);
  }

  private drawGroundLabels() {
    const { ctx } = this;
    const size = Math.max(12, Math.round(this.s * 0.5));
    ctx.font = `600 ${size}px Georgia, 'Times New Roman', serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = INK;
    for (const l of GROUND_LABELS) {
      const s = this.toScreen(l.at);
      ctx.fillText(l.text, s.x, s.y);
    }
  }

  private drawTrails(sim: Simulation) {
    const { ctx } = this;
    ctx.save();
    ctx.lineWidth = this.px(2);
    ctx.setLineDash([this.px(6), this.px(5)]);
    ctx.lineCap = 'round';
    for (const id of ['boulder', 'ball'] as const) {
      const t = sim.trails[id];
      if (t.length < 2) continue;
      this.path(t, false);
      ctx.strokeStyle = TRAIL[id];
      ctx.globalAlpha = 0.75;
      ctx.stroke();
    }
    ctx.restore();
  }

  /** Arrows for stones that have been thrown above the top of the view. */
  private drawOffscreen(sim: Simulation) {
    const { ctx } = this;
    for (const [body, color] of [
      [sim.boulder, TRAIL.boulder],
      [sim.ball, TRAIL.ball],
    ] as const) {
      const p = body.getPosition();
      if (p.y - STONE_RADIUS <= VIEW.y1) continue;
      const s = this.toScreen({ x: Math.min(Math.max(p.x, VIEW.x0 + 0.5), VIEW.x1 - 0.5), y: VIEW.y1 });
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(s.x, s.y + 4);
      ctx.lineTo(s.x - 8, s.y + 16);
      ctx.lineTo(s.x + 8, s.y + 16);
      ctx.closePath();
      ctx.fill();
      ctx.font = `600 12px Georgia, serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(`${(p.y - VIEW.y1).toFixed(0)} m up`, s.x, s.y + 19);
    }
  }

  private drawClock(sim: Simulation) {
    const { ctx } = this;
    ctx.font = `600 14px ui-monospace, 'SF Mono', Menlo, monospace`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle = INK;
    ctx.fillText(`t = ${sim.time.toFixed(2)} s`, 12, 10);
  }
}

type PoseDef = Record<
  'head' | 'shoulder' | 'hip' | 'kneeF' | 'footF' | 'kneeB' | 'footB' | 'elbowF' | 'handF' | 'elbowB' | 'handB',
  [number, number]
>;

// Key-points as fractions of body height. Origin is between the feet.
const POSES: Record<Person['pose'], PoseDef> = {
  stand: {
    head: [0, 0.915],
    shoulder: [0, 0.79],
    hip: [0, 0.48],
    kneeF: [0.03, 0.25],
    footF: [0.06, 0.02],
    kneeB: [-0.03, 0.25],
    footB: [-0.06, 0.02],
    elbowF: [0.05, 0.62],
    handF: [0.06, 0.46],
    elbowB: [-0.05, 0.62],
    handB: [-0.06, 0.46],
  },
  walk: {
    head: [0.02, 0.915],
    shoulder: [0.01, 0.79],
    hip: [0, 0.48],
    kneeF: [0.08, 0.27],
    footF: [0.14, 0.02],
    kneeB: [-0.03, 0.25],
    footB: [-0.12, 0.03],
    elbowF: [0.07, 0.63],
    handF: [0.12, 0.5],
    elbowB: [-0.06, 0.63],
    handB: [-0.1, 0.5],
  },
  crouch: {
    head: [0.06, 0.88],
    shoulder: [0.03, 0.74],
    hip: [-0.05, 0.44],
    kneeF: [0.15, 0.3],
    footF: [0.09, 0.02],
    kneeB: [0.07, 0.24],
    footB: [-0.09, 0.02],
    elbowF: [0.16, 0.66],
    handF: [0.1, 0.84],
    elbowB: [0.13, 0.6],
    handB: [0.04, 0.8],
  },
  push: {
    head: [0.16, 0.81],
    shoulder: [0.1, 0.7],
    hip: [-0.05, 0.45],
    kneeF: [0.06, 0.25],
    footF: [0.02, 0.02],
    kneeB: [-0.1, 0.22],
    footB: [-0.19, 0.02],
    elbowF: [0.15, 0.6],
    handF: [0.18, 0.68],
    elbowB: [0.13, 0.63],
    handB: [0.18, 0.7],
  },
};
