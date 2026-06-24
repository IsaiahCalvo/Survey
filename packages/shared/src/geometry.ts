// Geometry primitives shared across the apps.
//
// Bounds is the single canonical form: top-left origin + size, optional
// rotation. It matches the mobile RegionBounds shape and the `bounds` JSONB
// column. (The desktop has additional in-memory bounds representations — those
// are deliberately NOT unified here; see the migration plan.)

export type Point = {
  x: number;
  y: number;
};

export type Bounds = {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
};
