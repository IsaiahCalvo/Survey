import React from 'react';
import { Pressable, Text } from 'react-native';
import type { RegionConfig } from '@survey/shared';
import { styles } from '../styles';

export function RegionOverlay({
  pageWidth,
  pageHeight,
  region,
  editing,
  onPress,
  onLongPress,
}: {
  pageWidth: number;
  pageHeight: number;
  region: RegionConfig;
  editing: boolean;
  onPress: () => void;
  onLongPress: () => void;
}) {
  return (
    <Pressable
      delayLongPress={420}
      onPress={(event) => {
        event.stopPropagation();
        onPress();
      }}
      onLongPress={(event) => {
        event.stopPropagation();
        onLongPress();
      }}
      style={[
        styles.regionOverlay,
        editing && styles.regionOverlayEditing,
        {
          left: pageWidth * region.bounds.x,
          top: pageHeight * region.bounds.y,
          width: pageWidth * region.bounds.width,
          height: pageHeight * region.bounds.height,
        },
      ]}
    >
      <Text style={styles.regionOverlayText}>{region.name.split('-')[0].trim() || 'Region'}</Text>
    </Pressable>
  );
}
