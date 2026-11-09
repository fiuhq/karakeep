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

// The fork's over-the-air update server (an Expo Updates protocol server the operator hosts) and the app's id on it.
// CI passes both from repository variables, so this public file names neither.
function otaServer(): { url: string; appId: string } {
  const url = process.env.FIU_OTA_URL;
  const appId = process.env.FIU_OTA_APP_ID;
  if (!url || !appId) {
    throw new Error(
      "FIU_VARIANT=fiu needs FIU_OTA_URL and FIU_OTA_APP_ID: the update server and this app's id on it",
    );
  }
  return { url: url.replace(/\/+$/, ""), appId };
}

export default (): AppConfig => {
  if (process.env.FIU_VARIANT !== "fiu") return upstream;
  const expo = upstream.expo;
  const ota = otaServer();
  const { eas: _eas, ...extra } = expo.extra ?? {};
  return {
    expo: {
      ...expo,
      name: "Karakeep fiu",
      slug: "karakeep-fiu",
      // Its own scheme and package, so it installs beside the store app instead of clashing with its signature.
      scheme: "karakeep-fiu",
      ios: { ...expo.ios, bundleIdentifier: "one.fiu.karakeep" },
      android: { ...expo.android, package: "one.fiu.karakeep" },
      // An update reaches only builds whose native layer matches it exactly.
      runtimeVersion: { policy: "fingerprint" },
      updates: {
        url: `${ota.url}/manifest`,
        enabled: true,
        // The app accepts only updates signed by the server's key for this app; certs/fiu-ota.crt is its public half.
        codeSigningCertificate: "./certs/fiu-ota.crt",
        codeSigningMetadata: { keyid: "main", alg: "rsa-v1_5-sha256" },
        // expo-updates sends only headers declared at build time; the server routes on all three.
        requestHeaders: {
          "expo-channel-name": "trunk",
          "expo-app-id": ota.appId,
          "xprem-branch": "",
        },
      },
      extra: { ...extra, fiuVariant: true },
    },
  };
};
