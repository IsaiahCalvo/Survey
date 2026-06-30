import React from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { Lightbulb, SquareDashed, X } from 'lucide-react-native';
import type { RegionConfig, SpaceConfig } from '@survey/shared';
import { colors, SurveyIcon } from '../../constants';
import { styles } from '../../styles';

export function SpacePageRegionRow({
  space,
  pageNumber,
  region,
  regionCount,
  active,
  editing,
  surveyMode,
  spaceActive,
  onToggleRegion,
  onUpdateRegion,
  onLocatePage,
  onEditRegion,
  onCreateRegion,
  onRemovePage,
}: {
  space: SpaceConfig;
  pageNumber: number;
  region: RegionConfig | null;
  regionCount: number;
  active: boolean;
  editing: boolean;
  surveyMode: boolean;
  spaceActive: boolean;
  onToggleRegion: (spaceId: string, regionId: string) => void;
  onUpdateRegion: (spaceId: string, regionId: string, patch: Partial<RegionConfig>) => void;
  onLocatePage: (pageNumber: number) => void;
  onEditRegion: (spaceId: string, regionId: string) => void;
  onCreateRegion: (spaceId?: string, pageOverride?: number) => void;
  onRemovePage: (pageNumber: number) => void;
}) {
  const visibilityOn = surveyMode ? region?.showSurveyAnnotations : region?.showCanvasAnnotations;
  const visibilityDisabled = !spaceActive || !region;
  const regionLabel = region?.name?.trim() || `Region ${pageNumber}`;

  return (
    <View style={[styles.spacePageRow, active && styles.spacePageRowActive, editing && styles.spacePageRowEditing]}>
      <View style={styles.spacePageLeadingControls}>
        <Pressable accessibilityRole="button" accessibilityLabel={`Go to page ${pageNumber}`} style={styles.spacePagePill} onPress={() => onLocatePage(pageNumber)}>
          <Text style={styles.spacePagePillText}>{pageNumber}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="switch"
          accessibilityLabel={active ? 'Turn off region overlay' : 'Turn on region overlay'}
          disabled={!region}
          style={[styles.regionOverlayToggle, active && styles.toggleActive, !region && styles.regionOverlayToggleDisabled]}
          onPress={() => {
            if (region) onToggleRegion(space.id, region.id);
          }}
        >
          <View style={[styles.regionOverlayToggleKnob, active && styles.regionOverlayToggleKnobActive]} />
        </Pressable>
      </View>

      <View style={styles.spacePageCopy}>
        {region ? (
          <TextInput
            accessibilityLabel="Region name"
            value={region.name}
            onChangeText={(value) => onUpdateRegion(space.id, region.id, { name: value })}
            onBlur={() => {
              if (!region.name.trim()) onUpdateRegion(space.id, region.id, { name: `Region ${pageNumber}` });
            }}
            style={styles.spacePageRegionName}
          />
        ) : (
          <Text numberOfLines={1} style={styles.spacePageRegionName}>{regionLabel}</Text>
        )}
        <Text numberOfLines={1} style={styles.regionMeta}>
          {regionCount ? `${regionCount} region${regionCount === 1 ? '' : 's'}` : 'No region defined'}
        </Text>
      </View>

      <View style={styles.regionActionControls}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={editing ? 'Exit region edit' : 'Edit region area'}
          style={[styles.regionActionButton, editing && styles.regionActionButtonActive]}
          onPress={() => {
            if (region) onEditRegion(space.id, region.id);
            else onCreateRegion(space.id, pageNumber);
          }}
        >
          <SquareDashed color={editing ? colors.blue : colors.text} size={13} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={surveyMode ? 'Toggle survey annotations' : 'Toggle canvas annotations'}
          disabled={visibilityDisabled}
          style={[styles.regionActionButton, visibilityOn && styles.regionActionButtonActive, visibilityDisabled && styles.regionActionButtonDisabled]}
          onPress={() => {
            if (!region) return;
            if (surveyMode) onUpdateRegion(space.id, region.id, { showSurveyAnnotations: !region.showSurveyAnnotations });
            else onUpdateRegion(space.id, region.id, { showCanvasAnnotations: !region.showCanvasAnnotations });
          }}
        >
          {surveyMode ? (
            <SurveyIcon color={visibilityOn ? colors.blue : colors.text} size={13} />
          ) : (
            <Lightbulb color={visibilityOn ? colors.blue : colors.text} size={13} />
          )}
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Remove page from space"
          style={styles.regionActionButton}
          onPress={() => onRemovePage(pageNumber)}
        >
          <X color="#F08A8A" size={12} />
        </Pressable>
      </View>
    </View>
  );
}
