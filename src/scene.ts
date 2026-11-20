// Scene geometry, traced from the 1024×1024 puzzle image.
//
// Everything is written in the image's pixel coordinates (x right, y down) so it
// is easy to compare against the picture, then converted to world metres
// (x right, y up) at 55 px = 1 m. That makes B 1.8 m tall and the stones
// 1.6 m across, which keeps Box2D in its comfortable size range.

export interface Pt {
  x: number;
  y: number;
}

export const PX_PER_M = 55;
const ORIGIN_X = 88; // left edge of the structure in the image
const BASE_Y = 712; // bottom edge of the structure in the image

export const w = (px: number, py: number): Pt => ({
  x: (px - ORIGIN_X) / PX_PER_M,
  y: (BASE_Y - py) / PX_PER_M,
});
const poly = (pts: [number, number][]): Pt[] => pts.map(([x, y]) => w(x, y));
const len = (px: number) => px / PX_PER_M;

/** Convex solid blocks that make up the ground (Box2D needs convex pieces). */
export const TERRAIN_BLOCKS: Pt[][] = (
  [
    // tall column behind A
    [[88, 712], [88, 432], [120, 432], [120, 712]],
    // A's ledge
    [[120, 712], [120, 549], [168, 549], [168, 712]],
    // the wedge in front of A
    [[168, 712], [168, 549], [210, 522], [210, 712]],
    // B's floor
    [[210, 712], [210, 662], [302, 662], [302, 712]],
    // pillar between B and the seesaw stone (its right face slants)
    [[302, 712], [302, 572], [325, 572], [348, 662], [348, 712]],
    // pit floor under the seesaw and spikes
    [[348, 712], [348, 662], [594, 662], [594, 712]],
    // ground between the pit and D's hole, including the hole's overhanging lip
    [[594, 573], [636, 573], [617, 597], [594, 597]],
    [[594, 597], [617, 597], [617, 712], [594, 712]],
    [[617, 597], [628, 641], [617, 641]],
    // under D's feet
    [[617, 641], [678, 641], [678, 712], [617, 712]],
    // right side of D's hole
    [[678, 597], [678, 641], [668, 641]],
    [[659, 573], [678, 573], [678, 597]],
    // the ramp and E's plateau
    [[678, 712], [678, 573], [826, 440], [940, 440], [940, 712]],
  ] as [number, number][][]
).map(poly);

/** The outer silhouette of the ground, used only for drawing the ink outline. */
export const TERRAIN_OUTLINE: Pt[] = poly([
  [88, 712], [88, 432], [120, 432], [120, 549], [168, 549], [210, 522],
  [210, 662], [302, 662], [302, 572], [325, 572], [348, 662], [594, 662],
  [594, 573], [636, 573], [617, 597], [628, 641], [668, 641], [678, 597],
  [659, 573], [678, 573], [826, 440], [940, 440], [940, 712],
]);

export const FLOOR_Y = w(0, 662).y;

/** The slanted right face of the pillar that the seesaw stone leans on (top → bottom). */
export const PILLAR_FACE: [Pt, Pt] = [w(325, 572), w(348, 662)];

export const FULCRUM: Pt[] = poly([[455, 662], [476, 622], [497, 662]]);
/** The seesaw pivots on the tip of the fulcrum. */
export const PIVOT: Pt = w(476, 622);

export const PLANK = {
  left: len(118), // plank length left of the pivot (its left end rests on the floor)
  right: len(113), // plank length right of the pivot
  thickness: len(7),
  mass: 120,
  // the downward teeth under the plank's raised right end
  teeth: { from: 1.0, to: 1.9, count: 3, depth: 0.3 },
};

export const FLOOR_SPIKES = { x0: w(508, 0).x, x1: w(592, 0).x, count: 6, height: len(40) };

export const STONE_RADIUS = len(44);

export const PLATEAU = { edgeX: w(826, 0).x, y: w(0, 440).y, rightX: w(940, 0).x };

/** E's boulder sits on the lip of the plateau, just far enough back to stay put until pushed. */
export const BOULDER_START: Pt = { x: PLATEAU.edgeX + 0.05, y: PLATEAU.y + STONE_RADIUS };

export type Pose = 'stand' | 'walk' | 'push' | 'crouch';

export interface PersonSpec {
  id: 'A' | 'B' | 'D' | 'E';
  x: number;
  footY: number;
  height: number;
  pose: Pose;
  /** +1 faces right, -1 faces left */
  facing: 1 | -1;
}

export const D_HOLE_FLOOR_Y = w(0, 641).y;
/** D as drawn: standing in the hole with the top of the head just above ground level. */
export const D_STANDING_HEIGHT = len(75);
/** D ducking: everything below the lip of the hole. */
export const D_DUCKING_HEIGHT = len(58);

export const PEOPLE: PersonSpec[] = [
  { id: 'A', x: w(156, 0).x, footY: w(0, 549).y, height: len(117), pose: 'stand', facing: 1 },
  { id: 'B', x: w(258, 0).x, footY: FLOOR_Y, height: len(100), pose: 'walk', facing: 1 },
  { id: 'D', x: w(648, 0).x, footY: D_HOLE_FLOOR_Y, height: D_STANDING_HEIGHT, pose: 'stand', facing: 1 },
  { id: 'E', x: w(902, 0).x, footY: PLATEAU.y, height: 1.8, pose: 'push', facing: -1 },
];

export const PERSON_MASS = 70;
export const personHalfWidth = (h: number) => 0.11 * h;
export const personHeadRadius = (h: number) => 0.085 * h;

/** Letters painted on the masonry, matching the puzzle. */
export const GROUND_LABELS: { text: string; at: Pt }[] = [
  { text: 'A', at: w(140, 592) },
  { text: 'B', at: w(257, 690) },
  { text: 'C', at: w(543, 690) },
  { text: 'D', at: w(648, 680) },
];

/** The part of the world the canvas shows (metres). */
export const VIEW = { x0: -0.7, x1: 16.6, y0: -0.3, y1: 9.0 };
