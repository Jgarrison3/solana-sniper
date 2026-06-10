// The signature perforated golden ticket. Perforation is rendered as a
// notch circle on each side plus a dashed divider, like a tear-off stub.

import { StyleSheet, Text, View } from "react-native";
import { colors, fonts, radii, tabularNums } from "@/theme/tokens";

export function GoldenTicket({
  qty,
  label = "TICKETS",
  sublabel,
}: {
  qty: number;
  label?: string;
  sublabel?: string;
}) {
  return (
    <View style={styles.ticket}>
      <View style={[styles.notch, styles.notchLeft]} />
      <View style={[styles.notch, styles.notchRight]} />
      <View style={styles.stub}>
        <Text style={[styles.qty, tabularNums]}>{qty.toLocaleString("en-US")}</Text>
      </View>
      <View style={styles.divider} />
      <View style={styles.main}>
        <Text style={styles.label}>{label}</Text>
        {sublabel ? <Text style={styles.sublabel}>{sublabel}</Text> : null}
      </View>
    </View>
  );
}

const NOTCH = 18;

const styles = StyleSheet.create({
  ticket: {
    flexDirection: "row",
    backgroundColor: colors.gold,
    borderRadius: radii.md,
    overflow: "hidden",
    alignItems: "stretch",
    minHeight: 84,
  },
  notch: {
    position: "absolute",
    width: NOTCH,
    height: NOTCH,
    borderRadius: NOTCH / 2,
    backgroundColor: colors.mint,
    top: "50%",
    marginTop: -NOTCH / 2,
    zIndex: 2,
  },
  notchLeft: { left: -NOTCH / 2 },
  notchRight: { right: -NOTCH / 2 },
  stub: {
    width: 110,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 8,
  },
  qty: {
    fontFamily: fonts.display,
    fontSize: 34,
    color: colors.ink,
  },
  divider: {
    width: 1.5,
    marginVertical: 10,
    borderWidth: 0.75,
    borderColor: colors.ink,
    borderStyle: "dashed",
    opacity: 0.45,
  },
  main: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  label: {
    fontFamily: fonts.display,
    fontSize: 18,
    letterSpacing: 2.5,
    color: colors.ink,
  },
  sublabel: {
    fontFamily: fonts.bodyMedium,
    fontSize: 13,
    color: colors.ink,
    opacity: 0.75,
    marginTop: 2,
  },
});
