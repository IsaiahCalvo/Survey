import React, { useMemo, useRef, useState } from 'react';
import { PanResponder, Pressable, Text, View } from 'react-native';
import { Copy, GripVertical, MoreHorizontal } from 'lucide-react-native';
import type { Marker, InkMark, PageTransformState } from '../../types';
import { colors } from '../../constants';
import { styles } from '../../styles';
import { MiniPagePreview } from './MiniPagePreview';

export function PageThumb({
  page,
  displayNumber,
  active,
  markers,
  inkMarks,
  transformState,
  clipboardActive,
  onMove,
  onOpenMenu,
  onPress,
}: {
  page: number;
  displayNumber: number;
  active: boolean;
  markers: Marker[];
  inkMarks: InkMark[];
  transformState?: PageTransformState;
  clipboardActive: boolean;
  onMove: (page: number, delta: number) => void;
  onOpenMenu: (page: number, anchorX: number, anchorY: number) => void;
  onPress: () => void;
}) {
  const dragProgressRef = useRef(0);
  const dragEnabledRef = useRef(false);
  const suppressPressRef = useRef(false);
  const [dragging, setDragging] = useState(false);
  const previewTransform = transformState ?? { rotation: 0, mirrorHorizontal: false, mirrorVertical: false };

  function resetDragState() {
    dragProgressRef.current = 0;
    dragEnabledRef.current = false;
    setDragging(false);
  }

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: (_, gesture) => dragEnabledRef.current && Math.abs(gesture.dx) > 7 && Math.abs(gesture.dx) > Math.abs(gesture.dy),
        onMoveShouldSetPanResponderCapture: (_, gesture) => dragEnabledRef.current && Math.abs(gesture.dx) > 7 && Math.abs(gesture.dx) > Math.abs(gesture.dy),
        onPanResponderMove: (_, gesture) => {
          const step = 88;
          const delta = Math.trunc((gesture.dx - dragProgressRef.current) / step);
          if (!delta) return;
          dragProgressRef.current += delta * step;
          onMove(page, delta);
        },
        onPanResponderRelease: resetDragState,
        onPanResponderTerminate: resetDragState,
      }),
    [onMove, page]
  );

  return (
    <View style={[styles.pageCard, active && styles.pageCardActive, dragging && styles.pageCardDragging]} {...panResponder.panHandlers}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Open page ${displayNumber}`}
        style={styles.pageCardPressArea}
        delayLongPress={320}
        onLongPress={() => {
          dragEnabledRef.current = true;
          suppressPressRef.current = true;
          setDragging(true);
        }}
        onPress={() => {
          if (suppressPressRef.current) {
            suppressPressRef.current = false;
            return;
          }
          onPress();
        }}
      >
        <View
          style={[
            styles.pagePreviewPaper,
            {
              transform: [
                { rotate: `${previewTransform.rotation}deg` },
                { scaleX: previewTransform.mirrorHorizontal ? -1 : 1 },
                { scaleY: previewTransform.mirrorVertical ? -1 : 1 },
              ],
            },
          ]}
        >
          <MiniPagePreview page={page} markers={markers} inkMarks={inkMarks} />
        </View>
      </Pressable>
      <View style={styles.pageCardBadge}>
        <Text style={styles.pageCardBadgeText}>{displayNumber}</Text>
      </View>
      {clipboardActive ? <View style={styles.pageClipboardBadge}><Copy color={colors.green} size={11} /></View> : null}
      {active ? <View style={styles.pageActiveRail} /> : null}
      {dragging ? (
        <View style={styles.pageDragHandle}>
          <GripVertical color={colors.green} size={15} style={{ transform: [{ rotate: '90deg' }] }} />
        </View>
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Page ${displayNumber} actions`}
        hitSlop={8}
        style={styles.pageCardMore}
        onPress={(event) => {
          event.stopPropagation();
          onOpenMenu(page, event.nativeEvent.pageX, event.nativeEvent.pageY);
        }}
      >
        <MoreHorizontal color={colors.muted} size={18} style={{ transform: [{ rotate: '90deg' }] }} />
      </Pressable>
    </View>
  );
}
