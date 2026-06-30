import React from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { X } from 'lucide-react-native';
import { colors, versionHistoryItems } from '../constants';
import { styles } from '../styles';

export function VersionHistoryDrawer({
  panelHeight,
  bottomInset,
  onClose,
}: {
  panelHeight: number;
  bottomInset: number;
  onClose: () => void;
}) {
  return (
    <View style={[styles.drawer, { height: panelHeight, paddingBottom: bottomInset + 14 }]}>
      <View style={styles.drawerHeader}>
        <View>
          <Text style={styles.drawerTitle}>Version History</Text>
          <Text style={styles.drawerSubtitle}>Online status and recent document activity</Text>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="Hide version history panel" onPress={onClose}>
          <X color={colors.text} size={18} />
        </Pressable>
      </View>
      <ScrollView style={styles.versionList} contentContainerStyle={styles.versionListContent} showsVerticalScrollIndicator={false}>
        {versionHistoryItems.map((item) => (
          <View key={item.id} style={styles.versionRow}>
            <View style={styles.versionDot} />
            <View style={styles.versionCopy}>
              <Text style={styles.versionTitle}>{item.title}</Text>
              <Text style={styles.versionMeta}>{item.meta}</Text>
            </View>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}
