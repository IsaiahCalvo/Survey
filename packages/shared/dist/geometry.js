"use strict";
// Geometry primitives shared across the apps.
//
// Bounds is the single canonical form: top-left origin + size, optional
// rotation. It matches the mobile RegionBounds shape and the `bounds` JSONB
// column. (The desktop has additional in-memory bounds representations — those
// are deliberately NOT unified here; see the migration plan.)
Object.defineProperty(exports, "__esModule", { value: true });
//# sourceMappingURL=geometry.js.map