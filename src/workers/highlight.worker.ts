import { highlightAll } from "../utils/highlight";

export interface HighlightBatchItem {
  key: string;
  text: string;
  search: string;
}

export interface HighlightBatchRequest {
  type: "highlightBatch";
  requestId: number;
  items: HighlightBatchItem[];
}

export interface HighlightBatchResponse {
  type: "highlightBatchResult";
  requestId: number;
  results: Array<{ key: string; html: string }>;
}

self.onmessage = (event: MessageEvent<HighlightBatchRequest>) => {
  const request = event.data;
  if (request?.type !== "highlightBatch") return;

  const response: HighlightBatchResponse = {
    type: "highlightBatchResult",
    requestId: request.requestId,
    results: request.items.map((item) => ({
      key: item.key,
      html: highlightAll(item.text, item.search),
    })),
  };
  self.postMessage(response);
};
