import { Renderer } from './render.ts';
import { DEFAULTS, Simulation, TICK, type Params } from './sim.ts';

type NumericKey = Exclude<keyof Params, 'duck'>;

interface SliderDef {
  key: NumericKey;
  label: string;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  presets?: { label: string; value: number }[];
}

const SLIDERS: SliderDef[] = [
  { key: 'push', label: "E's push", min: 0, max: 60, step: 1, format: (v) => `${v} kN` },
  { key: 'boulderMass', label: "E's boulder mass", min: 100, max: 10000, step: 100, format: (v) => `${v.toLocaleString()} kg` },
  { key: 'ballMass', label: 'Seesaw stone mass', min: 50, max: 10000, step: 50, format: (v) => `${v.toLocaleString()} kg` },
  {
    key: 'gravity',
    label: 'Gravity',
    min: 1,
    max: 25,
    step: 0.01,
    format: (v) => `${v.toFixed(2)} m/s²`,
    presets: [
      { label: 'Moon', value: 1.62 },
      { label: 'Mars', value: 3.71 },
      { label: 'Earth', value: 9.81 },
      { label: 'Jupiter', value: 24.79 },
    ],
  },
  { key: 'bounce', label: 'Bounciness', min: 0, max: 0.9, step: 0.05, format: (v) => v.toFixed(2) },
  { key: 'friction', label: 'Friction', min: 0, max: 1, step: 0.05, format: (v) => v.toFixed(2) },
];

const ROSTER: { id: string; where: string }[] = [
  { id: 'A', where: 'on the high ledge' },
  { id: 'B', where: 'walking on the low floor' },
  { id: 'C', where: 'marks the spike pit (no one is drawn there)' },
  { id: 'D', where: 'in a hole at the foot of the ramp, head poking out' },
  { id: 'E', where: 'the one doing the pushing' },
];

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

// ---- state ---------------------------------------------------------------

const params: Params = readParamsFromUrl();
let sim = new Simulation(params);
type RunState = 'idle' | 'running' | 'paused' | 'done';
let runState: RunState = 'idle';
let speed = 1;
let showTrails = true;
let dirty = true;
let accumulator = 0;
let lastFrame = performance.now();
let shownDeaths = -1;

const canvas = $<HTMLCanvasElement>('scene');
const renderer = new Renderer(canvas);
const runBtn = $<HTMLButtonElement>('run');
const verdict = $<HTMLParagraphElement>('verdict');
const roster = $<HTMLUListElement>('roster');

// ---- settings UI -----------------------------------------------------------

const sliderInputs = new Map<NumericKey, { input: HTMLInputElement; out: HTMLOutputElement }>();

function buildSliders() {
  const host = $('sliders');
  for (const def of SLIDERS) {
    const row = document.createElement('div');
    row.className = 'slider';
    const id = `p-${def.key}`;
    row.innerHTML = `
      <div class="slider-head">
        <label for="${id}">${def.label}</label>
        <output for="${id}"></output>
      </div>
      <input id="${id}" type="range" min="${def.min}" max="${def.max}" step="${def.step}" />`;
    const input = row.querySelector('input')!;
    const out = row.querySelector('output')!;
    input.addEventListener('input', () => {
      params[def.key] = Number(input.value);
      out.textContent = def.format(params[def.key]);
      onParamsChanged();
    });
    if (def.presets) {
      const chips = document.createElement('div');
      chips.className = 'chips';
      for (const p of def.presets) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'chip';
        b.textContent = p.label;
        b.addEventListener('click', () => {
          params[def.key] = p.value;
          syncControls();
          onParamsChanged();
        });
        chips.append(b);
      }
      row.append(chips);
    }
    host.append(row);
    sliderInputs.set(def.key, { input, out });
  }
}

function syncControls() {
  for (const def of SLIDERS) {
    const { input, out } = sliderInputs.get(def.key)!;
    input.value = String(params[def.key]);
    out.textContent = def.format(params[def.key]);
  }
  $<HTMLInputElement>('duck').checked = params.duck;
}

function onParamsChanged() {
  writeParamsToUrl();
  reset();
}

// ---- run control -----------------------------------------------------------

function reset() {
  sim = new Simulation({ ...params });
  runState = 'idle';
  accumulator = 0;
  shownDeaths = -1;
  dirty = true;
  updateUi();
}

function onRunClick() {
  if (runState === 'running') runState = 'paused';
  else if (runState === 'paused') runState = 'running';
  else {
    if (runState === 'done') reset();
    runState = 'running';
    lastFrame = performance.now();
  }
  updateUi();
}

function updateUi() {
  runBtn.textContent = { idle: 'Run', running: 'Pause', paused: 'Resume', done: 'Run again' }[runState];
  runBtn.classList.toggle('running', runState === 'running');

  if (runState === 'idle') verdict.textContent = 'Press Run and E gives the boulder a shove.';
  else if (runState === 'done') {
    const dead = sim.deaths.map((d) => d.id);
    verdict.innerHTML = dead.length
      ? `<strong>${joinNames(dead)} ${dead.length === 1 ? 'dies' : 'die'}.</strong> Everything settled after ${sim.time.toFixed(1)} s.`
      : `<strong>Nobody dies.</strong> Everything settled after ${sim.time.toFixed(1)} s.`;
  } else verdict.textContent = runState === 'paused' ? 'Paused.' : 'Rolling…';

  if (shownDeaths !== sim.deaths.length) {
    shownDeaths = sim.deaths.length;
    renderRoster();
  }
}

function renderRoster() {
  roster.innerHTML = '';
  for (const r of ROSTER) {
    const li = document.createElement('li');
    const person = sim.people.find((p) => p.spec.id === r.id);
    let status = '<span class="status na">n/a</span>';
    if (person && person.alive) status = '<span class="status alive">alive</span>';
    if (person && !person.alive) {
      status = `<span class="status dead">dead</span>`;
      li.classList.add('is-dead');
    }
    const detail =
      person && !person.alive ? `${person.cause} at ${person.diedAt!.toFixed(2)} s` : r.where;
    li.innerHTML = `<span class="badge">${r.id}</span><span class="who">${detail}</span>${status}`;
    roster.append(li);
  }
}

function joinNames(ids: string[]) {
  if (ids.length <= 1) return ids.join('');
  return `${ids.slice(0, -1).join(', ')} and ${ids[ids.length - 1]}`;
}

// ---- main loop ---------------------------------------------------------------

function frame(now: number) {
  const dt = Math.min(0.1, (now - lastFrame) / 1000);
  lastFrame = now;
  if (runState === 'running') {
    accumulator += dt * speed;
    let steps = 0;
    while (accumulator >= TICK && steps < 2000 && !sim.finished) {
      sim.tick();
      accumulator -= TICK;
      steps++;
    }
    if (sim.finished) runState = 'done';
    updateUi();
    dirty = true;
  }
  if (dirty) {
    renderer.draw(sim, { trails: showTrails });
    dirty = false;
  }
  requestAnimationFrame(frame);
}

// ---- URL params ----------------------------------------------------------------

function readParamsFromUrl(): Params {
  const q = new URLSearchParams(location.search);
  const p: Params = { ...DEFAULTS };
  for (const def of SLIDERS) {
    const raw = q.get(def.key);
    const v = raw === null ? NaN : Number(raw);
    if (Number.isFinite(v)) p[def.key] = Math.min(def.max, Math.max(def.min, v));
  }
  if (q.has('duck')) p.duck = q.get('duck') !== '0';
  return p;
}

function writeParamsToUrl() {
  const q = new URLSearchParams();
  for (const def of SLIDERS) if (params[def.key] !== DEFAULTS[def.key]) q.set(def.key, String(params[def.key]));
  if (params.duck !== DEFAULTS.duck) q.set('duck', params.duck ? '1' : '0');
  const qs = q.toString();
  history.replaceState(null, '', qs ? `?${qs}` : location.pathname);
}

// ---- wiring ------------------------------------------------------------------

buildSliders();
syncControls();

runBtn.addEventListener('click', onRunClick);
$('reset').addEventListener('click', reset);
$('defaults').addEventListener('click', () => {
  Object.assign(params, DEFAULTS);
  syncControls();
  onParamsChanged();
});
$<HTMLInputElement>('duck').addEventListener('change', (e) => {
  params.duck = (e.target as HTMLInputElement).checked;
  onParamsChanged();
});
const speedInput = $<HTMLInputElement>('speed');
speedInput.addEventListener('input', () => {
  speed = Number(speedInput.value);
  $('speed-out').textContent = `${speed.toFixed(2).replace(/\.?0+$/, '')}×`;
});
$<HTMLInputElement>('trails').addEventListener('change', (e) => {
  showTrails = (e.target as HTMLInputElement).checked;
  dirty = true;
});
new ResizeObserver(() => {
  renderer.resize();
  dirty = true;
}).observe(canvas);

updateUi();
requestAnimationFrame(frame);
