import { Tabs } from "expo-router";
import { Text, type ColorValue } from "react-native";
import { DRAWINGS_ENABLED } from "@/lib/featureFlags";
import { colors, fonts } from "@/theme/tokens";

function TabIcon({ glyph, color }: { glyph: string; color: ColorValue }) {
  return <Text style={{ fontSize: 20, color }}>{glyph}</Text>;
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: colors.mint },
        tabBarActiveTintColor: colors.moss,
        tabBarInactiveTintColor: colors.inkMuted,
        tabBarStyle: { backgroundColor: colors.white },
        tabBarLabelStyle: { fontFamily: fonts.bodySemi, fontSize: 11 },
      }}
    >
      <Tabs.Screen
        name="home"
        options={{
          title: "Home",
          tabBarIcon: ({ color }) => <TabIcon glyph="⌂" color={color} />,
        }}
      />
      <Tabs.Screen
        name="drops"
        options={{
          title: "Drops",
          // Feature flag: hide the entire sweepstakes surface.
          href: DRAWINGS_ENABLED ? "/drops" : null,
          tabBarIcon: ({ color }) => <TabIcon glyph="◉" color={color} />,
        }}
      />
      <Tabs.Screen
        name="earn"
        options={{
          title: "Earn",
          href: DRAWINGS_ENABLED ? "/earn" : null,
          tabBarIcon: ({ color }) => <TabIcon glyph="✦" color={color} />,
        }}
      />
      <Tabs.Screen
        name="me"
        options={{
          title: "Me",
          tabBarIcon: ({ color }) => <TabIcon glyph="◌" color={color} />,
        }}
      />
    </Tabs>
  );
}
