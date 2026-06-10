// First-tickets celebration: the golden ticket springs in over a burst of
// falling confetti. Pure RN Animated — no extra dependencies.

import { useEffect, useMemo, useRef } from "react";
import { Animated, Easing, StyleSheet, View, useWindowDimensions } from "react-native";
import { colors } from "@/theme/tokens";
import { GoldenTicket } from "./GoldenTicket";

const CONFETTI_COLORS = [colors.gold, colors.moss, colors.brick, colors.ink];
const PIECES = 24;

function ConfettiPiece({ index, width }: { index: number; width: number }) {
  const fall = useRef(new Animated.Value(0)).current;
  const seed = useMemo(() => ({
    x: Math.random() * width,
    delay: index * 60 + Math.random() * 300,
    size: 6 + Math.random() * 8,
    rotations: 2 + Math.random() * 4,
    color: CONFETTI_COLORS[index % CONFETTI_COLORS.length],
    drift: (Math.random() - 0.5) * 120,
  }), [index, width]);

  useEffect(() => {
    Animated.timing(fall, {
      toValue: 1,
      duration: 2400 + Math.random() * 800,
      delay: seed.delay,
      easing: Easing.in(Easing.quad),
      useNativeDriver: true,
    }).start();
  }, [fall, seed.delay]);

  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: "absolute",
        top: -20,
        left: seed.x,
        width: seed.size,
        height: seed.size * 1.6,
        backgroundColor: seed.color,
        borderRadius: 2,
        transform: [
          {
            translateY: fall.interpolate({ inputRange: [0, 1], outputRange: [0, 700] }),
          },
          {
            translateX: fall.interpolate({ inputRange: [0, 1], outputRange: [0, seed.drift] }),
          },
          {
            rotate: fall.interpolate({
              inputRange: [0, 1],
              outputRange: ["0deg", `${seed.rotations * 360}deg`],
            }),
          },
        ],
        opacity: fall.interpolate({ inputRange: [0, 0.8, 1], outputRange: [1, 1, 0] }),
      }}
    />
  );
}

export function TicketCelebration({ qty, sublabel }: { qty: number; sublabel?: string }) {
  const { width } = useWindowDimensions();
  const scale = useRef(new Animated.Value(0.2)).current;

  useEffect(() => {
    Animated.spring(scale, {
      toValue: 1,
      friction: 5,
      tension: 60,
      delay: 250,
      useNativeDriver: true,
    }).start();
  }, [scale]);

  return (
    <View style={styles.container}>
      {Array.from({ length: PIECES }, (_, i) => (
        <ConfettiPiece key={i} index={i} width={width} />
      ))}
      <Animated.View style={{ transform: [{ scale }], width: "100%" }}>
        <GoldenTicket qty={qty} sublabel={sublabel} />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: "100%",
    alignItems: "center",
    justifyContent: "center",
    overflow: "visible",
  },
});
