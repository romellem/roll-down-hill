# Who dies if E pushes the stone?

A rigid-body physics simulation of the "only for geniuses" puzzle, built with
[Planck.js](https://piqnt.com/planck.js/) (a JavaScript port of Box2D) and Vite.

Press **Run** to watch E push the boulder. With the default settings the boulder clips D's head
(which pokes out of the hole), hops onto the seesaw's raised end, and the seesaw throws the other
stone onto B. Sliders adjust the push force, both stones' masses, gravity, bounciness and friction,
and a checkbox lets D duck all the way into the hole. Settings are saved in the URL, so you can share
a specific scenario.

## Develop

```sh
npm install
npm run dev      # local dev server
npm run build    # type-check and build to dist/
npm run preview  # serve the built site
```

## Deploy to GitHub Pages

The workflow in `.github/workflows/deploy.yml` builds and deploys on every push to `main`.
One-time setup: in the repo's **Settings → Pages**, set **Source** to **GitHub Actions**.

The build uses a relative base path, so it works at `https://<user>.github.io/<repo>/` without config changes.

## Model notes

- Geometry is traced from the puzzle image at 55 px = 1 m (`src/scene.ts`).
- E's boulder defaults to 10× the seesaw stone's mass (4,000 kg vs 400 kg). A seesaw only passes on
  part of the boulder's energy, so with similar masses the stone can't clear the pillar to reach B.
- A person dies if a stone changes their velocity by more than 3 m/s within 1/60 s, if anything
  else does so by more than 10 m/s, or if they touch a spike (`src/sim.ts`).
- Physics steps at a fixed 240 Hz, so results are deterministic for a given set of settings.
