import type { Asset, AssetVisibility } from "@openengage/orpc";

export interface UploadOptions {
  file: File;
  visibility?: AssetVisibility;
  onProgress?: (percent: number) => void;
  signal?: AbortSignal;
}

/**
 * Uploads through the streaming route rather than `orpcQuery.assets.upload`:
 * the oRPC procedure takes a `z.file()`, which buffers the entire body into
 * Worker memory and caps out well below a full slide deck.
 */
export async function uploadAssetFile(options: UploadOptions): Promise<Asset> {
  const dimensions = await readImageDimensions(options.file);
  const query = new URLSearchParams({ name: options.file.name });
  if (options.visibility) query.set("visibility", options.visibility);
  if (dimensions) {
    query.set("width", String(dimensions.width));
    query.set("height", String(dimensions.height));
  }
  return send("POST", `/api/assets/upload?${query.toString()}`, options);
}

/** Replaces an asset's bytes while keeping its id, so embedded URLs survive. */
export async function replaceAssetContent(id: string, options: UploadOptions): Promise<Asset> {
  const dimensions = await readImageDimensions(options.file);
  const query = new URLSearchParams({ name: options.file.name });
  if (dimensions) {
    query.set("width", String(dimensions.width));
    query.set("height", String(dimensions.height));
  }
  return send("PUT", `/api/assets/${encodeURIComponent(id)}/content?${query.toString()}`, options);
}

/**
 * XMLHttpRequest rather than fetch: fetch exposes no upload-progress event, and
 * a 100MB upload with no feedback is unusable.
 */
function send(method: "POST" | "PUT", url: string, options: UploadOptions): Promise<Asset> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open(method, url);
    request.responseType = "json";
    request.setRequestHeader("content-type", options.file.type || "application/octet-stream");

    request.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) {
        options.onProgress?.(Math.round((event.loaded / event.total) * 100));
      }
    });
    request.addEventListener("load", () => {
      if (request.status >= 200 && request.status < 300) {
        options.onProgress?.(100);
        resolve(request.response as Asset);
        return;
      }
      reject(new Error(readErrorMessage(request)));
    });
    request.addEventListener("error", () => reject(new Error("アップロードに失敗しました")));
    request.addEventListener("abort", () => reject(new Error("アップロードを中止しました")));
    options.signal?.addEventListener("abort", () => request.abort(), { once: true });

    request.send(options.file);
  });
}

function readErrorMessage(request: XMLHttpRequest): string {
  const body = request.response as { error?: { message?: string } } | null;
  return body?.error?.message ?? `アップロードに失敗しました (${request.status})`;
}

/**
 * Workers have no image decoder, so pixel dimensions have to be measured here
 * and sent along. A failure is non-fatal - the columns are nullable.
 */
export async function readImageDimensions(
  file: File,
): Promise<{ width: number; height: number } | null> {
  if (!file.type.startsWith("image/") || typeof createImageBitmap !== "function") return null;
  try {
    const bitmap = await createImageBitmap(file);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return size;
  } catch {
    return null;
  }
}
