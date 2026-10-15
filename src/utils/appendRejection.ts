/** Plain rejection data preserves the failure kind across Electron contextBridge. */
export interface LiveAppendRejection {
  kind: "live-entry-limit";
  message: string;
}

export function isLiveAppendRejection(
  value: unknown,
): value is LiveAppendRejection {
  return (
    value !== null &&
    typeof value === "object" &&
    !(value instanceof Error) &&
    "kind" in value &&
    value.kind === "live-entry-limit" &&
    "message" in value &&
    typeof value.message === "string" &&
    value.message.length > 0
  );
}
