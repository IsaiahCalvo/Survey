import React, { useMemo, useRef } from 'react';
import { PanResponder, Pressable, Text, TextInput, View } from 'react-native';
import { ChevronDown, ChevronLeft, ChevronRight, GripVertical, Plus, X } from 'lucide-react-native';
import type { RegionConfig, SpaceConfig } from '@survey/shared';
import { colors } from '../../constants';
import { styles } from '../../styles';
import { summarizePages, parsePageRangeDraft } from '../../utils/pageUtils';
import { SpacePageRegionRow } from './SpacePageRegionRow';

export function SpaceRow({
  space,
  index,
  count,
  active,
  activeRegionId,
  editingRegionId,
  pageDraft,
  pageError,
  surveyMode,
  onPageDraftChange,
  onCommitPages,
  onAssignPages,
  onToggleSpace,
  onToggleRegion,
  onUpdateSpace,
  onUpdateRegion,
  onDeleteSpace,
  onCreateRegion,
  onMoveSpace,
  onLocatePage,
  onEditRegion,
}: {
  space: SpaceConfig;
  index: number;
  count: number;
  active: boolean;
  activeRegionId: string | null;
  editingRegionId: string | null;
  pageDraft: string;
  pageError: string | null;
  surveyMode: boolean;
  onPageDraftChange: (value: string) => void;
  onCommitPages: () => void;
  onAssignPages: (spaceId: string, pages: number[]) => void;
  onToggleSpace: (spaceId: string) => void;
  onToggleRegion: (spaceId: string, regionId: string) => void;
  onUpdateSpace: (spaceId: string, patch: Partial<SpaceConfig>) => void;
  onUpdateRegion: (spaceId: string, regionId: string, patch: Partial<RegionConfig>) => void;
  onDeleteSpace: (spaceId: string) => void;
  onCreateRegion: (spaceId?: string, pageOverride?: number) => void;
  onMoveSpace: (spaceId: string, delta: number) => void;
  onLocatePage: (pageNumber: number) => void;
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
          const step = 58;
          const delta = Math.trunc((gesture.dy - dragProgressRef.current) / step);
          if (!delta) return;
          dragProgressRef.current += delta * step;
          onMoveSpace(space.id, delta);
        },
        onPanResponderRelease: () => {
          dragProgressRef.current = 0;
        },
        onPanResponderTerminate: () => {
          dragProgressRef.current = 0;
        },
      }),
    [onMoveSpace, space.id]
  );
  const first = index === 0;
  const last = index === count - 1;
  const sortedPages = [...space.pages].sort((a, b) => a - b);

  return (
    <View style={[styles.spaceCard, active && styles.spaceCardActive]} {...panResponder.panHandlers}>
      <View style={styles.spaceCardHeader}>
        <View style={styles.spaceCardLeadingControls}>
          <View style={styles.spaceDragHandle}>
            <GripVertical color={colors.faint} size={15} />
          </View>
          <View style={styles.spaceRegionCountBadge}>
            <Text style={styles.spaceRegionCountText}>{space.regions.length}</Text>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel={space.expanded ? 'Collapse space' : 'Expand space'} style={styles.spaceExpandButton} onPress={() => onUpdateSpace(space.id, { expanded: !space.expanded })}>
            <ChevronDown color={colors.muted} size={14} style={{ transform: [{ rotate: space.expanded ? '0deg' : '-90deg' }] }} />
          </Pressable>
        </View>
        <TextInput
          accessibilityLabel="Space name"
          value={space.name}
          onChangeText={(value) => onUpdateSpace(space.id, { name: value })}
          onBlur={() => {
            if (!space.name.trim()) onUpdateSpace(space.id, { name: `Space ${index + 1}` });
          }}
          style={styles.spaceNameInput}
        />
        <View style={styles.spaceHeaderControls}>
          <Pressable accessibilityRole="switch" accessibilityLabel={active ? 'Turn off space' : 'Turn on space'} style={[styles.toggle, active && styles.toggleActive]} onPress={() => onToggleSpace(space.id)}>
            <View style={[styles.toggleKnob, active && styles.toggleKnobActive]} />
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Delete space" style={styles.spaceDeleteButton} onPress={() => onDeleteSpace(space.id)}>
            <X color="#F08A8A" size={13} />
          </Pressable>
        </View>
      </View>

      {!space.expanded ? (
        <View style={styles.spaceCollapsedMetaRow}>
          <Text numberOfLines={1} style={styles.spaceMeta}>{summarizePages(space.pages)} · {space.regions.length} region{space.regions.length === 1 ? '' : 's'}</Text>
          <View style={styles.rowMoveButtons}>
            <Pressable disabled={first} accessibilityRole="button" accessibilityLabel="Move space up" style={[styles.bookmarkMoveButton, first && styles.bookmarkMoveButtonDisabled]} onPress={() => onMoveSpace(space.id, -1)}>
              <ChevronLeft color={first ? colors.faint : colors.text} size={13} style={{ transform: [{ rotate: '90deg' }] }} />
            </Pressable>
            <Pressable disabled={last} accessibilityRole="button" accessibilityLabel="Move space down" style={[styles.bookmarkMoveButton, last && styles.bookmarkMoveButtonDisabled]} onPress={() => onMoveSpace(space.id, 1)}>
              <ChevronRight color={last ? colors.faint : colors.text} size={13} style={{ transform: [{ rotate: '90deg' }] }} />
            </Pressable>
          </View>
        </View>
      ) : null}

      {space.expanded ? (
        <View style={styles.spaceExpandedBody}>
          <View style={styles.spacePageAssignRow}>
            <TextInput
              accessibilityLabel="Assigned pages"
              value={pageDraft}
              keyboardType="numbers-and-punctuation"
              returnKeyType="done"
              onChangeText={onPageDraftChange}
              onSubmitEditing={onCommitPages}
              placeholder="Add pages (e.g. 3, 6-9, 12)"
              placeholderTextColor={colors.faint}
              style={styles.spacePageInput}
            />
            <Pressable accessibilityRole="button" accessibilityLabel="Add pages" style={styles.spaceAddPagesButton} onPress={onCommitPages}>
              <Plus color={colors.text} size={14} />
            </Pressable>
          </View>
          {pageError ? <Text style={styles.spacePageError}>{pageError}</Text> : null}

          <View style={styles.spacePageRows}>
            {sortedPages.length ? (
              sortedPages.map((pageNumber) => {
                const pageRegions = space.regions.filter((region) => region.page === pageNumber);
                const primaryRegion = pageRegions[0] ?? null;
                return (
                  <SpacePageRegionRow
                    key={`${space.id}:${pageNumber}`}
                    space={space}
                    pageNumber={pageNumber}
                    region={primaryRegion}
                    regionCount={pageRegions.length}
                    active={Boolean(primaryRegion && activeRegionId === primaryRegion.id)}
                    editing={Boolean(primaryRegion && editingRegionId === primaryRegion.id)}
                    surveyMode={surveyMode}
                    spaceActive={active}
                    onToggleRegion={onToggleRegion}
                    onUpdateRegion={onUpdateRegion}
                    onLocatePage={onLocatePage}
                    onEditRegion={onEditRegion}
                    onCreateRegion={onCreateRegion}
                    onRemovePage={(pageToRemove) => {
                      const nextPages = space.pages.filter((page) => page !== pageToRemove);
                      onAssignPages(space.id, nextPages);
                    }}
                  />
                );
              })
            ) : (
              <View style={styles.spaceNoPagesRow}>
                <Text style={styles.regionMeta}>No pages added yet.</Text>
              </View>
            )}
          </View>

          <View style={styles.spaceExpandedFooter}>
            <Pressable disabled={first} accessibilityRole="button" accessibilityLabel="Move space up" style={[styles.bookmarkMoveButton, first && styles.bookmarkMoveButtonDisabled]} onPress={() => onMoveSpace(space.id, -1)}>
              <ChevronLeft color={first ? colors.faint : colors.text} size={13} style={{ transform: [{ rotate: '90deg' }] }} />
            </Pressable>
            <Pressable disabled={last} accessibilityRole="button" accessibilityLabel="Move space down" style={[styles.bookmarkMoveButton, last && styles.bookmarkMoveButtonDisabled]} onPress={() => onMoveSpace(space.id, 1)}>
              <ChevronRight color={last ? colors.faint : colors.text} size={13} style={{ transform: [{ rotate: '90deg' }] }} />
            </Pressable>
          </View>
        </View>
      ) : null}
    </View>
  );
}
