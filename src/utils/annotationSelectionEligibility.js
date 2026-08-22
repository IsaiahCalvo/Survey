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
  || isTransformLockedAnnotation(annotation)
);
