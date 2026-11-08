// fiuhq fork: a build of this app with its own identity and over-the-air updates, layered on upstream's
// app.config.js (Expo reads app.config.ts first), so upstream's file stays untouched. Only FIU_VARIANT=fiu changes
// anything; every other build gets upstream's config as it is.
import type { ExpoConfig } from "expo/config";

interface AppConfig {
  expo: ExpoConfig;
}

function isAppConfig(value: unknown): value is AppConfig {
  return typeof value === "object" && value !== null && "expo" in value;
}

// Upstream's app.config.js, read with require: TypeScript would resolve an import of "./app.config.js" to this
// file. It is an ES module loaded through a CommonJS loader, so its default export may arrive wrapped once more.
function loadUpstream(): AppConfig {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const loaded: unknown = require("./app.config.js");
  for (let value = loaded, depth = 0; depth < 3; depth++) {
    if (isAppConfig(value)) return value;
    if (typeof value !== "object" || value === null || !("default" in value))
      break;
    value = (value as { default: unknown }).default;
  }
  throw new Error("app.config.js did not export an Expo config");
}

const upstream = loadUpstream();

// The fork's Expo project; updates are published to it from CI on every trunk change.
const FIU_PROJECT_ID = "405d0ac7-e0ba-4daa-b4d6-555349cf232b";

export default (): AppConfig => {
  if (process.env.FIU_VARIANT !== "fiu") return upstream;
  const expo = upstream.expo;
  return {
    expo: {
      ...expo,
      name: "Karakeep fiu",
      slug: "karakeep-fiu",
      owner: "dinhphieu",
      // Its own scheme and package, so it installs beside the store app instead of clashing with its signature.
      scheme: "karakeep-fiu",
      ios: { ...expo.ios, bundleIdentifier: "one.fiu.karakeep" },
      android: { ...expo.android, package: "one.fiu.karakeep" },
      // An update reaches only builds whose native layer matches it exactly.
      runtimeVersion: { policy: "fingerprint" },
      updates: { url: `https://u.expo.dev/${FIU_PROJECT_ID}` },
      extra: { ...expo.extra, eas: { projectId: FIU_PROJECT_ID } },
    },
  };
};
