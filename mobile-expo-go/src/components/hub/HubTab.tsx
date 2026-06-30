import React from 'react';
import { Pressable } from 'react-native';
import type { HubMode } from '../../types';
import { colors } from '../../constants';
import { styles } from '../../styles';

export function HubTab({
  mode,
  activeMode,
  setHubMode,
  icon: Icon,
  label,
}: {
  mode: HubMode;
  activeMode: HubMode;
  setHubMode: (mode: HubMode) => void;
  icon: React.ComponentType<any>;
  label: string;
}) {
  const active = mode === activeMode;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} style={[styles.hubTab, active && styles.hubTabActive]} onPress={() => setHubMode(mode)}>
      <Icon color={active ? colors.green : colors.muted} size={19} />
    </Pressable>
  );
}
