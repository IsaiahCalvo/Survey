import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { styles } from '../styles';

export function FloorPlan({ pageWidth, pageHeight }: { pageWidth: number; pageHeight: number }) {
  const wall = '#303640';
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <View style={[styles.planWall, { left: pageWidth * 0.12, top: pageHeight * 0.16, width: pageWidth * 0.76, height: 3, backgroundColor: wall }]} />
      <View style={[styles.planWall, { left: pageWidth * 0.12, top: pageHeight * 0.16, width: 3, height: pageHeight * 0.62, backgroundColor: wall }]} />
      <View style={[styles.planWall, { left: pageWidth * 0.88, top: pageHeight * 0.16, width: 3, height: pageHeight * 0.62, backgroundColor: wall }]} />
      <View style={[styles.planWall, { left: pageWidth * 0.12, top: pageHeight * 0.78, width: pageWidth * 0.76, height: 3, backgroundColor: wall }]} />
      <View style={[styles.planWall, { left: pageWidth * 0.43, top: pageHeight * 0.16, width: 3, height: pageHeight * 0.34, backgroundColor: wall }]} />
      <View style={[styles.planWall, { left: pageWidth * 0.12, top: pageHeight * 0.5, width: pageWidth * 0.76, height: 3, backgroundColor: wall }]} />
      <View style={[styles.planWall, { left: pageWidth * 0.63, top: pageHeight * 0.5, width: 3, height: pageHeight * 0.28, backgroundColor: wall }]} />
      <Text style={[styles.roomLabel, { left: pageWidth * 0.2, top: pageHeight * 0.27 }]}>LOBBY</Text>
      <Text style={[styles.roomLabel, { left: pageWidth * 0.54, top: pageHeight * 0.29 }]}>OFFICE</Text>
      <Text style={[styles.roomLabel, { left: pageWidth * 0.24, top: pageHeight * 0.62 }]}>RETAIL</Text>
      <Text style={[styles.roomLabel, { left: pageWidth * 0.68, top: pageHeight * 0.63 }]}>IDF</Text>
    </View>
  );
}
