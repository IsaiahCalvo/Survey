import React from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { X } from 'lucide-react-native';
import { activeUsers, colors } from '../constants';
import { styles } from '../styles';

export function ActiveUsersDrawer({
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
          <Text style={styles.drawerTitle}>Active Users</Text>
          <Text style={styles.drawerSubtitle}>{activeUsers.length} people currently in this document</Text>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="Hide active users panel" onPress={onClose}>
          <X color={colors.text} size={18} />
        </Pressable>
      </View>
      <ScrollView style={styles.versionList} contentContainerStyle={styles.versionListContent} showsVerticalScrollIndicator={false}>
        {activeUsers.map((user, index) => (
          <View key={user.id} style={styles.activeUserRow}>
            <View style={[styles.activeUserAvatar, index === 0 && styles.activeUserAvatarOwner]}>
              <Text style={styles.activeUserAvatarText}>{user.initials}</Text>
            </View>
            <View style={styles.versionCopy}>
              <Text style={styles.versionTitle}>{user.name}</Text>
              <Text style={styles.versionMeta}>{user.role} - {user.status}</Text>
            </View>
            <View style={styles.activeUserStatusDot} />
          </View>
        ))}
      </ScrollView>
    </View>
  );
}
