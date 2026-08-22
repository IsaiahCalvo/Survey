export const isTransformLockedAnnotation = (annotation) => Boolean(
  annotation?.lockMovementX
  && annotation?.lockMovementY
  && annotation?.lockScalingX
  && annotation?.lockScalingY
  && annotation?.lockRotation
);

export const isBlockedFromAreaSelection = (annotation) => Boolean(
  !annotation
  || annotation.deleted
  || annotation.deletedAt
  || annotation.isDeleted
  || annotation.blocked
  || annotation.isBlocked
  || annotation.locked
  // Text markup is a fixed page-space group on purpose. It may still be
  // selected as one unit for color, opacity, delete, and history edits.
  || (isTransformLockedAnnotation(annotation) && annotation?.data?.type !== 'text-markup')
);
