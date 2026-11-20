import { World, Box, Circle, Polygon, RevoluteJoint, type Body, type Contact } from 'planck';
import {
  BOULDER_START,
  D_DUCKING_HEIGHT,
  FLOOR_SPIKES,
  FLOOR_Y,
  FULCRUM,
  PEOPLE,
  PERSON_MASS,
  PILLAR_FACE,
  PIVOT,
  PLANK,
  STONE_RADIUS,
  TERRAIN_BLOCKS,
  personHalfWidth,
  personHeadRadius,
  type PersonSpec,
  type Pose,
  type Pt,
} from './scene.ts';

export interface Params {
  /** E's push, in kN, applied while the boulder is within arm's reach. */
  push: number;
  boulderMass: number;
  ballMass: number;
  gravity: number;
  bounce: number;
  friction: number;
  /** D ducks fully into the hole instead of standing with the head poking out. */
  duck: boolean;
}

export const DEFAULTS: Params = {
  push: 12,
  boulderMass: 4000,
  ballMass: 400,
  gravity: 9.81,
  bounce: 0.1,
  friction: 0.6,
  duck: false,
};

type Kind = 'terrain' | 'stone' | 'spike' | 'plank' | 'person';
type StoneId = 'boulder' | 'ball';
interface Tag {
  kind: Kind;
  id?: string;
}

/** Physics runs at a fixed 240 Hz so results don't depend on frame rate or playback speed. */
export const TICK = 1 / 240;
/** Impacts are judged over 1/60 s windows (4 ticks). */
const WINDOW_TICKS = 4;
/** Velocity change (m/s) inside one window that counts as a lethal hit from a stone. */
const LETHAL_STONE_DV = 3;
/** Velocity change (m/s) inside one window from anything else (ground, plank, people). */
const LETHAL_FALL_DV = 10;
/** E keeps pushing until the boulder is this far away (m) or this much time has passed (s). */
const PUSH_REACH = 0.6;
const PUSH_MAX_TIME = 1.5;
const MAX_TIME = 20;

export interface Person {
  spec: PersonSpec;
  body: Body;
  pose: Pose;
  alive: boolean;
  cause?: string;
  diedAt?: number;
  stoneImpulse: Record<StoneId, number>;
  otherImpulse: number;
}

export interface Death {
  id: string;
  cause: string;
  time: number;
}

export class Simulation {
  readonly world: World;
  readonly params: Params;
  readonly people: Person[] = [];
  readonly boulder: Body;
  readonly ball: Body;
  readonly plank: Body;
  readonly deaths: Death[] = [];
  readonly trails: Record<StoneId, Pt[]> = { boulder: [], ball: [] };
  time = 0;
  finished = false;
  private ticks = 0;
  private pushing = true;

  constructor(params: Params) {
    this.params = params;
    const world = new World({ gravity: { x: 0, y: -params.gravity } });
    this.world = world;
    const friction = params.friction;

    // Ground
    const ground = world.createBody({ type: 'static' });
    for (const block of TERRAIN_BLOCKS) {
      ground.createFixture({ shape: new Polygon(block), friction, userData: { kind: 'terrain' } });
    }

    // Floor spikes at C
    const spikes = world.createBody({ type: 'static' });
    const spikeW = (FLOOR_SPIKES.x1 - FLOOR_SPIKES.x0) / FLOOR_SPIKES.count;
    for (let i = 0; i < FLOOR_SPIKES.count; i++) {
      const x0 = FLOOR_SPIKES.x0 + i * spikeW;
      spikes.createFixture({
        shape: new Polygon([
          { x: x0, y: FLOOR_Y },
          { x: x0 + spikeW, y: FLOOR_Y },
          { x: x0 + spikeW / 2, y: FLOOR_Y + FLOOR_SPIKES.height },
        ]),
        friction,
        userData: { kind: 'spike' },
      });
    }

    // Fulcrum + seesaw plank. The plank's origin is the pivot, on its underside.
    const fulcrum = world.createBody({ type: 'static' });
    fulcrum.createFixture({ shape: new Polygon(FULCRUM), friction, userData: { kind: 'terrain' } });

    const restAngle = Math.asin((PIVOT.y - FLOOR_Y) / PLANK.left); // left end resting on the floor
    const plank = world.createBody({ type: 'dynamic', position: PIVOT, angle: restAngle });
    const plankLen = PLANK.left + PLANK.right;
    const plankDensity = PLANK.mass / (plankLen * PLANK.thickness);
    plank.createFixture({
      shape: new Box(plankLen / 2, PLANK.thickness / 2, {
        x: (PLANK.right - PLANK.left) / 2,
        y: PLANK.thickness / 2,
      }),
      density: plankDensity,
      friction,
      userData: { kind: 'plank' },
    });
    const { from, to, count, depth } = PLANK.teeth;
    const toothW = (to - from) / count;
    for (let i = 0; i < count; i++) {
      const x0 = from + i * toothW;
      plank.createFixture({
        shape: new Polygon([
          { x: x0, y: 0 },
          { x: x0 + toothW, y: 0 },
          { x: x0 + toothW / 2, y: -depth },
        ]),
        density: plankDensity,
        friction,
        userData: { kind: 'spike' },
      });
    }
    world.createJoint(new RevoluteJoint({}, fulcrum, plank, PIVOT));
    this.plank = plank;

    // The stone resting on the seesaw: wedged between the pillar's slanted face and the plank.
    this.ball = this.createStone('ball', restingBallCenter(restAngle), params.ballMass);
    this.boulder = this.createStone('boulder', BOULDER_START, params.boulderMass);

    // People: a rigid box body with a round head.
    for (const base of PEOPLE) {
      const spec: PersonSpec =
        base.id === 'D' && params.duck ? { ...base, height: D_DUCKING_HEIGHT, pose: 'crouch' } : base;
      const hw = personHalfWidth(spec.height);
      const hr = personHeadRadius(spec.height);
      const torsoH = spec.height - 2 * hr;
      const area = 2 * hw * torsoH + Math.PI * hr * hr;
      const density = PERSON_MASS / area;
      const body = world.createBody({ type: 'dynamic', position: { x: spec.x, y: spec.footY } });
      const tag: Tag = { kind: 'person', id: spec.id };
      body.createFixture({ shape: new Box(hw, torsoH / 2, { x: 0, y: torsoH / 2 }), density, friction, userData: tag });
      body.createFixture({ shape: new Circle({ x: 0, y: spec.height - hr }, hr), density, friction, userData: tag });
      this.people.push({
        spec,
        body,
        pose: spec.pose,
        alive: true,
        stoneImpulse: { boulder: 0, ball: 0 },
        otherImpulse: 0,
      });
    }

    world.on('begin-contact', (c) => this.onBeginContact(c));
    world.on('post-solve', (c, impulse) => {
      const n = c.getManifold().pointCount;
      let j = 0;
      for (let i = 0; i < n; i++) j += Math.hypot(impulse.normalImpulses[i], impulse.tangentImpulses[i]);
      const a = tagOf(c, 'A');
      const b = tagOf(c, 'B');
      if (a.kind === 'person') this.addImpulse(a.id!, b, j);
      if (b.kind === 'person') this.addImpulse(b.id!, a, j);
    });
  }

  private createStone(id: StoneId, at: Pt, mass: number): Body {
    const body = this.world.createBody({
      type: 'dynamic',
      position: at,
      bullet: true,
      angularDamping: 0.1, // a touch of rolling resistance so things eventually settle
    });
    body.createFixture({
      shape: new Circle(STONE_RADIUS),
      density: mass / (Math.PI * STONE_RADIUS * STONE_RADIUS),
      friction: this.params.friction,
      restitution: this.params.bounce,
      userData: { kind: 'stone', id },
    });
    return body;
  }

  private person(id: string) {
    return this.people.find((p) => p.spec.id === id)!;
  }

  private onBeginContact(c: Contact) {
    const a = tagOf(c, 'A');
    const b = tagOf(c, 'B');
    if (a.kind === 'person' && b.kind === 'spike') this.kill(a.id!, 'impaled on the spikes');
    if (b.kind === 'person' && a.kind === 'spike') this.kill(b.id!, 'impaled on the spikes');
  }

  private addImpulse(personId: string, other: Tag, j: number) {
    const p = this.person(personId);
    if (other.kind === 'stone') p.stoneImpulse[other.id as StoneId] += j;
    else p.otherImpulse += j;
  }

  private kill(id: string, cause: string) {
    const p = this.person(id);
    if (!p.alive) return;
    p.alive = false;
    p.cause = cause;
    p.diedAt = this.time;
    if (p.pose === 'push') p.pose = 'stand';
    this.deaths.push({ id, cause, time: this.time });
  }

  /** Advance the simulation by one fixed tick. */
  tick() {
    if (this.finished) return;

    if (this.pushing) {
      const moved = BOULDER_START.x - this.boulder.getPosition().x;
      if (this.time > PUSH_MAX_TIME || moved > PUSH_REACH || this.params.push <= 0) {
        this.pushing = false;
        this.person('E').pose = 'stand';
      } else {
        this.boulder.applyForceToCenter({ x: -this.params.push * 1000, y: 0 }, true);
      }
    }

    this.world.step(TICK, 10, 6);
    this.time += TICK;
    this.ticks++;

    if (this.ticks % WINDOW_TICKS === 0) {
      this.judgeImpacts();
      this.recordTrails();
      this.checkFinished();
    }
  }

  private judgeImpacts() {
    for (const p of this.people) {
      if (p.alive) {
        const m = p.body.getMass();
        if (p.stoneImpulse.boulder / m > LETHAL_STONE_DV) this.kill(p.spec.id, 'crushed by the boulder');
        else if (p.stoneImpulse.ball / m > LETHAL_STONE_DV) this.kill(p.spec.id, 'hit by the seesaw stone');
        else if (p.otherImpulse / m > LETHAL_FALL_DV) this.kill(p.spec.id, 'killed by a hard fall');
      }
      p.stoneImpulse.boulder = 0;
      p.stoneImpulse.ball = 0;
      p.otherImpulse = 0;
    }
  }

  private recordTrails() {
    for (const id of ['boulder', 'ball'] as const) {
      const pos = (id === 'boulder' ? this.boulder : this.ball).getPosition();
      const trail = this.trails[id];
      const last = trail[trail.length - 1];
      if (!last || Math.hypot(pos.x - last.x, pos.y - last.y) > 0.04) trail.push({ x: pos.x, y: pos.y });
    }
  }

  private checkFinished() {
    if (this.time >= MAX_TIME) {
      this.finished = true;
      return;
    }
    if (this.time < 1.5 || this.pushing) return;
    for (let b = this.world.getBodyList(); b; b = b.getNext()) {
      if (b.isDynamic() && b.isAwake()) return;
    }
    this.finished = true;
  }

  /** Run to completion without rendering. */
  runToEnd() {
    while (!this.finished) this.tick();
    return this;
  }
}

/** Where a stone of STONE_RADIUS touches both the pillar's slanted face and the plank's top face. */
function restingBallCenter(plankAngle: number): Pt {
  const [f0, f1] = PILLAR_FACE;
  const fl = Math.hypot(f1.x - f0.x, f1.y - f0.y);
  // Unit normals pointing into open air: right/up off the pillar face, up off the plank.
  const n1 = { x: -(f1.y - f0.y) / fl, y: (f1.x - f0.x) / fl };
  const n2 = { x: -Math.sin(plankAngle), y: Math.cos(plankAngle) };
  // Solve n1·c = r + n1·f0 and n2·c = thickness + r + n2·pivot.
  const c1 = STONE_RADIUS + n1.x * f0.x + n1.y * f0.y;
  const c2 = PLANK.thickness + STONE_RADIUS + n2.x * PIVOT.x + n2.y * PIVOT.y;
  const det = n1.x * n2.y - n1.y * n2.x;
  return { x: (c1 * n2.y - n1.y * c2) / det, y: (n1.x * c2 - c1 * n2.x) / det };
}

function tagOf(c: Contact, which: 'A' | 'B'): Tag {
  const f = which === 'A' ? c.getFixtureA() : c.getFixtureB();
  return (f.getUserData() as Tag | undefined) ?? { kind: 'terrain' };
}
