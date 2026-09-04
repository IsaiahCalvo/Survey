export const isTransformLockedAnnotation = (annotation) => Boolean(
  annotation?.lockMovementX
  && annotation?.lockMovementY
  && annotation?.lockScalingX
  && annotation?.lockScalingY
  && annotation?.lockRotation
);

export const isMovementLockedAnnotation = (annotation) => Boolean(
  annotation?.lockMovementX && annotation?.lockMovementY
);

export const isAnnotationTransformHandleLocked = (annotation, handleId) => {
  if (!annotation || !handleId) return true;
  const isTextRangeHandle = annotation?.data?.type === 'text-markup'
    && ['ml', 'mr'].includes(handleId);
  if (isTextRangeHandle) return false;
  if (handleId === 'mtr') return Boolean(annotation.lockRotation);
  if (['ml', 'mr'].includes(handleId)) return Boolean(annotation.lockScalingX);
  if (['mt', 'mb'].includes(handleId)) return Boolean(annotation.lockScalingY);
  if (['tl', 'tr', 'bl', 'br'].includes(handleId)) {
    return Boolean(annotation.lockScalingX && annotation.lockScalingY);
  }
  return false;
};

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
