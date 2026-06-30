import React, { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Layers, Plus, X } from 'lucide-react-native';
import type { RegionConfig, SpaceConfig } from '@survey/shared';
import { colors, ExportIcon } from '../../constants';
import { styles } from '../../styles';
import { parsePageRangeDraft } from '../../utils/pageUtils';
import { SpaceRow } from './SpaceRow';

export function SpacesDrawer({
  spaces,
  activeSpaceId,
  activeRegionId,
  editingRegionId,
  panelHeight,
  bottomInset,
  totalPages,
  surveyMode,
  onToggleSpace,
  onToggleRegion,
  onUpdateSpace,
  onUpdateRegion,
  onAssignPages,
  onCreateSpace,
  onDeleteSpace,
  onCreateRegion,
  onMoveSpace,
  onLocatePage,
  onEditRegion,
  onExitRegion,
  onClose,
}: {
  spaces: SpaceConfig[];
  activeSpaceId: string | null;
  activeRegionId: string | null;
  editingRegionId: string | null;
  panelHeight: number;
  bottomInset: number;
  totalPages: number;
  surveyMode: boolean;
  onToggleSpace: (spaceId: string) => void;
  onToggleRegion: (spaceId: string, regionId: string) => void;
  onUpdateSpace: (spaceId: string, patch: Partial<SpaceConfig>) => void;
  onUpdateRegion: (spaceId: string, regionId: string, patch: Partial<RegionConfig>) => void;
  onAssignPages: (spaceId: string, pages: number[]) => void;
  onCreateSpace: () => void;
  onDeleteSpace: (spaceId: string) => void;
  onCreateRegion: (spaceId?: string, pageOverride?: number) => void;
  onMoveSpace: (spaceId: string, delta: number) => void;
  onLocatePage: (pageNumber: number) => void;
  onEditRegion: (spaceId: string, regionId: string) => void;
  onExitRegion: () => void;
  onClose: () => void;
}) {
  const [pageDrafts, setPageDrafts] = useState<Record<string, string>>({});
  const [pageErrors, setPageErrors] = useState<Record<string, string | null>>({});
  const [exportOpen, setExportOpen] = useState(false);
  const exportTarget = spaces.find((space) => space.id === activeSpaceId) ?? spaces[0] ?? null;

  function commitPages(space: SpaceConfig) {
    const rawDraft = pageDrafts[space.id] ?? '';
    const { pages, error } = parsePageRangeDraft(rawDraft, totalPages);
    if (error || pages.length === 0) {
      setPageErrors((current) => ({ ...current, [space.id]: error ?? 'Enter pages.' }));
      return;
    }
    onAssignPages(space.id, pages);
    setPageErrors((current) => ({ ...current, [space.id]: null }));
    setPageDrafts((current) => ({ ...current, [space.id]: pages.join(', ') }));
  }

  return (
    <View style={[styles.drawer, styles.spacesDrawer, { height: panelHeight, paddingBottom: bottomInset + 12 }]}>
      <View style={styles.spacesDrawerHeader}>
        <View>
          <Text style={styles.drawerTitle}>Spaces</Text>
          <Text style={styles.drawerSubtitle}>{activeRegionId ? 'Region active' : activeSpaceId ? 'Space active' : 'No space active'}</Text>
        </View>
        <View style={styles.spacesHeaderActions}>
          <Pressable accessibilityRole="button" accessibilityLabel="Create space" style={styles.spacesHeaderButton} onPress={onCreateSpace}>
            <Plus color={colors.text} size={16} />
          </Pressable>
          <View style={styles.spacesExportWrap}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={exportTarget ? `Export ${exportTarget.name}` : 'Export space'}
              disabled={!exportTarget}
              style={[styles.spacesHeaderButton, exportOpen && styles.spacesHeaderButtonActive, !exportTarget && styles.spacesHeaderButtonDisabled]}
              onPress={() => {
                if (!exportTarget) return;
                setExportOpen((open) => !open);
              }}
            >
              <ExportIcon color={exportOpen ? colors.blue : colors.text} size={16} />
            </Pressable>
            {exportOpen && exportTarget ? (
              <View style={styles.spacesExportMenu}>
                <Pressable accessibilityRole="button" accessibilityLabel="Export space CSV" style={styles.spacesExportMenuItem} onPress={() => setExportOpen(false)}>
                  <Text style={styles.spacesExportMenuText}>CSV</Text>
                </Pressable>
                <Pressable accessibilityRole="button" accessibilityLabel="Export space PDF pages" style={styles.spacesExportMenuItem} onPress={() => setExportOpen(false)}>
                  <Text style={styles.spacesExportMenuText}>PDF Pages</Text>
                </Pressable>
              </View>
            ) : null}
          </View>
        </View>
      </View>

      <ScrollView style={styles.spacesList} contentContainerStyle={styles.spacesListContent} showsVerticalScrollIndicator={spaces.length > 2}>
        {spaces.length ? (
          spaces.map((space, index) => (
            <SpaceRow
              key={space.id}
              space={space}
              index={index}
              count={spaces.length}
              active={activeSpaceId === space.id}
              activeRegionId={activeRegionId}
              editingRegionId={editingRegionId}
              pageDraft={pageDrafts[space.id] ?? ''}
              pageError={pageErrors[space.id] ?? null}
              surveyMode={surveyMode}
              onPageDraftChange={(value) => {
                setPageDrafts((current) => ({ ...current, [space.id]: value }));
                setPageErrors((current) => ({ ...current, [space.id]: null }));
              }}
              onCommitPages={() => commitPages(space)}
              onAssignPages={onAssignPages}
              onToggleSpace={onToggleSpace}
              onToggleRegion={onToggleRegion}
              onUpdateSpace={onUpdateSpace}
              onUpdateRegion={onUpdateRegion}
              onDeleteSpace={onDeleteSpace}
              onCreateRegion={onCreateRegion}
              onMoveSpace={onMoveSpace}
              onLocatePage={onLocatePage}
              onEditRegion={onEditRegion}
            />
          ))
        ) : (
          <View style={styles.spaceEmptyState}>
            <Layers color={colors.muted} size={22} />
            <Text style={styles.spaceEmptyText}>No spaces yet</Text>
          </View>
        )}
      </ScrollView>

      <Pressable accessibilityRole="button" accessibilityLabel="Exit spaces and regions mode" style={styles.exitRegionButtonFull} onPress={onExitRegion}>
        <Text style={styles.exitRegionText}>Exit Spaces / Regions</Text>
      </Pressable>
    </View>
  );
}
