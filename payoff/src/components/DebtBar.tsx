// The debt bar that drains as you pay: the brick-colored fill is what
// REMAINS, so progress means watching it shrink toward zero.

import { useEffect, useRef } from "react";
import { Animated, StyleSheet, View } from "react-native";
import { colors, radii } from "@/theme/tokens";

export function DebtBar({
  percentPaid,
  height = 12,
}: {
  /** 0..100 — how much of the original balance is gone. */
  percentPaid: number;
  height?: number;
}) {
  const remaining = Math.max(0, Math.min(100, 100 - percentPaid));
  const anim = useRef(new Animated.Value(remaining)).current;

  useEffect(() => {
    Animated.timing(anim, {
      toValue: remaining,
      duration: 700,
      useNativeDriver: false,
    }).start();
  }, [remaining, anim]);

  return (
    <View style={[styles.track, { height, borderRadius: height / 2 }]}>
      <Animated.View
        style={[
          styles.fill,
          {
            height,
            borderRadius: height / 2,
            width: anim.interpolate({
              inputRange: [0, 100],
              outputRange: ["0%", "100%"],
            }),
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    backgroundColor: colors.mossSoft,
    overflow: "hidden",
    borderRadius: radii.pill,
  },
  fill: {
    backgroundColor: colors.brick,
  },
});
