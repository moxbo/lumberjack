export type SharedMainApi = {
  setTcpOwnerWindowId?: (winId: number | null) => void;
  getTcpOwnerWindowId?: () => number | null;
  applyWindowTitles?: () => void;
  getWindowBaseTitle?: (winId: number) => string;
  setWindowBaseTitle?: (winId: number, title: string) => void;
  getWindowCanTcpControl?: (winId: number) => boolean;
  setWindowCanTcpControl?: (winId: number, allowed: boolean) => void;
  updateAppMenu?: () => void;
};

export function getSharedMainApi(): SharedMainApi {
  const globalWithApi = globalThis as typeof globalThis & {
    lumberjack?: SharedMainApi;
  };
  if (!globalWithApi.lumberjack) {
    globalWithApi.lumberjack = {};
  }
  return globalWithApi.lumberjack;
}
