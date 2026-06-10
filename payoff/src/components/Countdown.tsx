import { useEffect, useState } from "react";
import { Text } from "react-native";
import { fonts, tabularNums } from "@/theme/tokens";

function remaining(closesAt: string): string {
  const ms = new Date(closesAt).getTime() - Date.now();
  if (ms <= 0) return "Closed";
  const days = Math.floor(ms / 86_400_000);
  const hours = Math.floor((ms % 86_400_000) / 3_600_000);
  const mins = Math.floor((ms % 3_600_000) / 60_000);
  const secs = Math.floor((ms % 60_000) / 1000);
  if (days > 0) return `${days}d ${hours}h ${mins}m`;
  if (hours > 0) return `${hours}h ${mins}m ${secs}s`;
  return `${mins}m ${secs}s`;
}

export function Countdown({ closesAt, color }: { closesAt: string; color: string }) {
  const [text, setText] = useState(() => remaining(closesAt));
  useEffect(() => {
    const t = setInterval(() => setText(remaining(closesAt)), 1000);
    return () => clearInterval(t);
  }, [closesAt]);
  return (
    <Text style={[{ fontFamily: fonts.displaySemi, fontSize: 16, color }, tabularNums]}>
      {text}
    </Text>
  );
}
