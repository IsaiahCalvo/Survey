import React, { useMemo, useRef } from 'react';
import { PanResponder, Pressable, Text, View } from 'react-native';
import { Bookmark, ChevronLeft, ChevronRight, GripVertical, Layers } from 'lucide-react-native';
import type { BookmarkEntry } from '../../types';
import { colors } from '../../constants';
import { styles } from '../../styles';

export function BookmarkRow({
  bookmark,
  first,
  last,
  onMove,
  onPress,
}: {
  bookmark: BookmarkEntry;
  first: boolean;
  last: boolean;
  onMove: (bookmarkId: string, delta: number) => void;
  onPress: () => void;
}) {
  const dragProgressRef = useRef(0);
  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dy) > 7,
        onMoveShouldSetPanResponderCapture: (_, gesture) => Math.abs(gesture.dy) > 7 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
        onPanResponderMove: (_, gesture) => {
          const rowStep = 38;
          const delta = Math.trunc((gesture.dy - dragProgressRef.current) / rowStep);
          if (!delta) return;
          dragProgressRef.current += delta * rowStep;
          onMove(bookmark.id, delta);
        },
        onPanResponderRelease: () => {
          dragProgressRef.current = 0;
        },
        onPanResponderTerminate: () => {
          dragProgressRef.current = 0;
        },
      }),
    [bookmark.id, onMove]
  );

  return (
    <View style={[styles.bookmarkItem, { marginLeft: bookmark.depth * 14 }]} {...panResponder.panHandlers}>
      <View style={styles.bookmarkDragHandle}>
        <GripVertical color={colors.faint} size={15} />
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Open bookmark ${bookmark.title}`}
        style={styles.bookmarkOpenArea}
        onPress={onPress}
      >
        <View style={styles.bookmarkIconBubble}>
          {bookmark.type === 'folder' ? <Layers color="#8FB7FF" size={13} /> : <Bookmark color={colors.muted} size={13} />}
        </View>
        <View style={styles.bookmarkCopy}>
          <Text numberOfLines={1} style={styles.bookmarkTitle}>{bookmark.title}</Text>
          <Text style={styles.resultMeta}>{bookmark.page ? `Page ${bookmark.page}` : 'Folder'} · PDF outline</Text>
        </View>
      </Pressable>
      <View style={styles.bookmarkMoveButtons}>
        <Pressable disabled={first} accessibilityRole="button" accessibilityLabel="Move bookmark up" style={[styles.bookmarkMoveButton, first && styles.bookmarkMoveButtonDisabled]} onPress={() => onMove(bookmark.id, -1)}>
          <ChevronLeft color={first ? colors.faint : colors.text} size={13} style={{ transform: [{ rotate: '90deg' }] }} />
        </Pressable>
        <Pressable disabled={last} accessibilityRole="button" accessibilityLabel="Move bookmark down" style={[styles.bookmarkMoveButton, last && styles.bookmarkMoveButtonDisabled]} onPress={() => onMove(bookmark.id, 1)}>
          <ChevronRight color={last ? colors.faint : colors.text} size={13} style={{ transform: [{ rotate: '90deg' }] }} />
        </Pressable>
      </View>
    </View>
  );
}
