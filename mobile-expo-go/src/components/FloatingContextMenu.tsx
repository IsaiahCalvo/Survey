import React from 'react';
import { Pressable, Text, View } from 'react-native';
import type { ContextMenuState } from '../types';
import { styles } from '../styles';

export function FloatingContextMenu({
  menu,
  onDismiss,
}: {
  menu: ContextMenuState;
  onDismiss: () => void;
}) {
  return (
    <>
      <Pressable style={styles.contextMenuDismissLayer} onPress={onDismiss} />
      <View style={[styles.contextMenuPanel, { left: menu.x, top: menu.y, width: menu.width ?? 154 }]}>
        <Text numberOfLines={1} style={styles.contextMenuTitle}>{menu.title}</Text>
        <View style={styles.contextMenuDivider} />
        {menu.actions.map((action) => (
          <Pressable
            key={action.id}
            accessibilityRole="button"
            accessibilityLabel={action.label}
            disabled={action.disabled}
            style={[styles.contextMenuAction, action.disabled && styles.contextMenuActionDisabled]}
            onPress={() => {
              if (action.disabled) return;
              action.onPress();
            }}
          >
            <Text style={[
              styles.contextMenuActionText,
              action.destructive && styles.contextMenuActionTextDestructive,
              action.disabled && styles.contextMenuActionTextDisabled,
            ]}>
              {action.label}
            </Text>
          </Pressable>
        ))}
      </View>
    </>
  );
}
