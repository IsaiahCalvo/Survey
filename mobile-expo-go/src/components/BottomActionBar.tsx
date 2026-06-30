import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { ChevronDown, Layers } from 'lucide-react-native';
import type { HubMode } from '../types';
import { colors, hubItems, SurveyIcon } from '../constants';
import { styles } from '../styles';

export function BottomActionBar({
  openSpaces,
  openSurvey,
  toggleHub,
  hubMode,
  hubOpen,
  spacesModeActive,
  surveyModeActive,
  bottomInset,
}: {
  openSpaces: () => void;
  openSurvey: () => void;
  toggleHub: () => void;
  hubMode: HubMode;
  hubOpen: boolean;
  spacesModeActive: boolean;
  surveyModeActive: boolean;
  bottomInset: number;
}) {
  const activeHub = hubItems.find((item) => item.id === hubMode) ?? hubItems[0];
  const HubIcon = activeHub.icon;

  return (
    <View style={[styles.bottomActionBar, { height: 52 + bottomInset, paddingBottom: 4 }]}>
      <View pointerEvents="none" style={[styles.bottomBarSurface, { height: 36 + bottomInset }]} />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Open spaces panel"
        style={[styles.bottomSideButton, styles.bottomActionNudge, spacesModeActive && styles.bottomSideButtonActive]}
        onPress={openSpaces}
      >
        <Layers color={spacesModeActive ? colors.blue : colors.text} size={22} />
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Open document hub"
        style={[styles.bottomHubButton, styles.bottomActionNudge, hubOpen && styles.bottomHubButtonActive]}
        onPress={toggleHub}
      >
        <HubIcon color={hubOpen ? colors.blue : colors.text} size={19} />
        <Text numberOfLines={1} style={[styles.bottomHubText, hubOpen && styles.bottomHubTextActive]}>{activeHub.label}</Text>
        <ChevronDown color={hubOpen ? colors.blue : colors.muted} size={13} />
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Open survey panel"
        style={[styles.bottomSideButton, styles.bottomActionNudge, surveyModeActive && styles.bottomSideButtonActive]}
        onPress={openSurvey}
      >
        <SurveyIcon color={surveyModeActive ? colors.blue : colors.text} size={23} />
      </Pressable>
    </View>
  );
}
