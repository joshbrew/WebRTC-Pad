import { playerSlots } from "../public/players.js";
export function readConfig(env = process.env, platform = process.platform) {
  const controllerType =
    platform === "win32" ? env.WINDOWS_CONTROLLER_TYPE || "auto" : "native";
  const controllerOutputs =
    platform === "win32"
      ? [
          {
            id: "auto",
            label: "Automatic · works with mixed controller groups",
            maxPlayers: null,
          },
          {
            id: "x360",
            label: "Xbox / XInput · widest game compatibility",
            maxPlayers: 4,
          },
          {
            id: "ds4",
            label: "PlayStation / HID · for larger groups",
            maxPlayers: null,
          },
        ]
      : [
          {
            id: "native",
            label:
              platform === "linux"
                ? "Linux virtual gamepads"
                : "macOS virtual gamepads",
            maxPlayers: null,
          },
        ];
  const selected = controllerOutputs.find(
    (output) => output.id === controllerType,
  );
  if (!selected)
    throw new Error("WINDOWS_CONTROLLER_TYPE must be auto, x360 or ds4");
  const maxPlayers = selected.maxPlayers;
  const playerCount = Number(env.PLAYER_COUNT || 4);
  if (
    !Number.isInteger(playerCount) ||
    playerCount < 1 ||
    playerCount > (maxPlayers ?? 64)
  )
    throw new Error(
      `Manual startup reservations must be 1–${maxPlayers ?? 64}; use press-to-join for adaptive players${controllerType === "x360" ? " (XInput has four controller indices; use WINDOWS_CONTROLLER_TYPE=ds4 for larger groups)" : ""}`,
    );
  const maxPeers =
    env.MAX_PEERS === undefined || env.MAX_PEERS === ""
      ? 0
      : Number(env.MAX_PEERS);
  if (!Number.isSafeInteger(maxPeers) || maxPeers < 0)
    throw new Error(
      "MAX_PEERS must be 0 (no configured limit) or a positive integer",
    );
  let publicUrl = null;
  if (env.PUBLIC_URL) {
    const url = new URL(env.PUBLIC_URL);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== "/"
    )
      throw new Error(
        "PUBLIC_URL must be an HTTPS origin, for example https://play.example.com",
      );
    publicUrl = url.origin;
  }
  const fallbackEnabled = env.SIGNALING_FALLBACK === "1";
  if (fallbackEnabled && !publicUrl)
    throw new Error(
      "Set PUBLIC_URL to your public HTTPS origin before enabling SIGNALING_FALLBACK",
    );
  return {
    playerCount,
    slots: playerSlots(playerCount),
    controllerType,
    controllerOutputs,
    maxPlayers,
    maxPeers,
    publicUrl,
    fallbackEnabled,
  };
}
