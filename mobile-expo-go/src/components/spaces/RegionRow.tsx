import React, { useMemo, useRef } from 'react';
import { PanResponder, Pressable, Text, TextInput, View } from 'react-native';
import { ChevronLeft, ChevronRight, GripVertical, Search, SquareDashed, X } from 'lucide-react-native';
import type { RegionConfig } from '@survey/shared';
import { colors } from '../../constants';
import { styles } from '../../styles';

export function RegionRow({
  spaceId,
  region,
  index,
  count,
  active,
  editing,
  onToggleRegion,
  onUpdateRegion,
  onDeleteRegion,
  onMoveRegion,
  onLocateRegion,
  onEditRegion,
}: {
  spaceId: string;
  region: RegionConfig;
  index: number;
  count: number;
  active: boolean;
  editing: boolean;
  onToggleRegion: (spaceId: string, regionId: string) => void;
  onUpdateRegion: (spaceId: string, regionId: string, patch: Partial<RegionConfig>) => void;
  onDeleteRegion: (spaceId: string, regionId: string) => void;
  onMoveRegion: (spaceId: string, regionId: string, delta: number) => void;
  onLocateRegion: (spaceId: string, regionId: string) => void;
  onEditRegion: (spaceId: string, regionId: string) => void;
}) {
  const dragProgressRef = useRef(0);
  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dy) > 7,
        onMoveShouldSetPanResponderCapture: (_, gesture) => Math.abs(gesture.dy) > 7 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
        onPanResponderMove: (_, gesture) => {
          const step = 48;
          const delta = Math.trunc((gesture.dy - dragProgressRef.current) / step);
          if (!delta) return;
          dragProgressRef.current += delta * step;
          onMoveRegion(spaceId, region.id, delta);
        },
        onPanResponderRelease: () => {
          dragProgressRef.current = 0;
        },
        onPanResponderTerminate: () => {
          dragProgressRef.current = 0;
        },
      }),
    [onMoveRegion, region.id, spaceId]
  );
  const first = index === 0;
  const last = index === count - 1;

  return (
    <View style={[styles.regionCard, active && styles.regionCardActive, editing && styles.regionCardEditing]} {...panResponder.panHandlers}>
      <View style={styles.regionDragHandle}>
        <GripVertical color={colors.faint} size={14} />
      </View>
      <View style={styles.regionCopy}>
        <TextInput
          accessibilityLabel="Region name"
          value={region.name}
          onChangeText={(value) => onUpdateRegion(spaceId, region.id, { name: value })}
          onBlur={() => {
            if (!region.name.trim()) onUpdateRegion(spaceId, region.id, { name: `Region ${index + 1}` });
          }}
          style={styles.regionNameInput}
        />
        <Text style={styles.regionMeta}>Page {region.page} · {region.surveyBound ? 'Survey-bound' : 'Regular annotations'}</Text>
      </View>
      <View style={styles.regionActions}>
        <Pressable accessibilityRole="button" accessibilityLabel="Locate region" style={styles.regionActionButton} onPress={() => onLocateRegion(spaceId, region.id)}>
          <Search color={colors.text} size={13} />
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Edit region" style={[styles.regionActionButton, editing && styles.regionActionButtonActive]} onPress={() => onEditRegion(spaceId, region.id)}>
          <SquareDashed color={editing ? colors.blue : colors.text} size={13} />
        </Pressable>
        <Pressable accessibilityRole="switch" accessibilityLabel="Region active" style={[styles.regionToggle, active && styles.toggleActive]} onPress={() => onToggleRegion(spaceId, region.id)}>
          <View style={[styles.regionToggleKnob, active && styles.regionToggleKnobActive]} />
        </Pressable>
      </View>
      <View style={styles.regionMoveDeleteRow}>
        <Pressable disabled={first} accessibilityRole="button" accessibilityLabel="Move region up" style={[styles.regionTinyButton, first && styles.bookmarkMoveButtonDisabled]} onPress={() => onMoveRegion(spaceId, region.id, -1)}>
          <ChevronLeft color={first ? colors.faint : colors.text} size={12} style={{ transform: [{ rotate: '90deg' }] }} />
        </Pressable>
        <Pressable disabled={last} accessibilityRole="button" accessibilityLabel="Move region down" style={[styles.regionTinyButton, last && styles.bookmarkMoveButtonDisabled]} onPress={() => onMoveRegion(spaceId, region.id, 1)}>
          <ChevronRight color={last ? colors.faint : colors.text} size={12} style={{ transform: [{ rotate: '90deg' }] }} />
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Delete region" style={styles.regionTinyButton} onPress={() => onDeleteRegion(spaceId, region.id)}>
          <X color={colors.muted} size={12} />
        </Pressable>
      </View>
    </View>
  );
}
