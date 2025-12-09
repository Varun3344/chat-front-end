type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface RequestOptions {
  method?: HttpMethod;
  body?: any;
  query?: Record<string, string | number | boolean | undefined | null>;
  headers?: Record<string, string>;
  apiKey?: string;
  signal?: AbortSignal;
  useBaseUrl?: boolean;
}

const BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  "";

const isFormData = (value: unknown): value is FormData => {
  if (typeof FormData === "undefined") return false;
  return value instanceof FormData;
};

const trimSlashes = (value: string) => value.replace(/\/+$/, "");

const resolveUrl = (path: string, query?: RequestOptions["query"], useBaseUrl = true) => {
  const hasProtocol = /^https?:\/\//i.test(path);
  let absoluteUrl = path;

  if (!hasProtocol && useBaseUrl) {
    const base = trimSlashes(BASE_URL || "");
    const suffix = path.startsWith("/") ? path : `/${path}`;
    absoluteUrl = `${base}${suffix}`;
  } else if (!hasProtocol && !useBaseUrl) {
    throw new Error("Absolute URLs are required when useBaseUrl is disabled.");
  }

  const url = new URL(absoluteUrl);
  if (query) {
    Object.entries(query).forEach(([key, rawValue]) => {
      if (rawValue === undefined || rawValue === null) return;
      url.searchParams.set(key, String(rawValue));
    });
  }
  return url.toString();
};

const readError = async (response: Response) => {
  try {
    const payload = await response.json();
    if (typeof payload === "string") return payload;
    if (payload?.message) return payload.message;
    if ("error" in (payload ?? {})) return String(payload.error);
    return JSON.stringify(payload);
  } catch {
    try {
      return await response.text();
    } catch {
      return "Unknown error";
    }
  }
};

export async function httpRequest<T = any>(path: string, options: RequestOptions = {}): Promise<T> {
  const {
    method = "GET",
    body,
    headers: customHeaders,
    apiKey,
    query,
    signal,
    useBaseUrl = true,
  } = options;

  if (!BASE_URL && useBaseUrl && !/^https?:\/\//i.test(path)) {
    throw new Error(
      "Missing NEXT_PUBLIC_API_BASE_URL (or NEXT_PUBLIC_API_URL). Please update your .env file."
    );
  }

  const headers: Record<string, string> = {
    Accept: "application/json",
    ...customHeaders,
  };

  if (apiKey) {
    headers["x-api-key"] = apiKey;
  }

  let requestBody: BodyInit | undefined;
  if (body !== undefined && body !== null) {
    if (isFormData(body)) {
      requestBody = body;
    } else {
      headers["Content-Type"] = "application/json";
      requestBody = JSON.stringify(body);
    }
  }

  const url = resolveUrl(path, query, useBaseUrl);

  const response = await fetch(url, {
    method,
    headers,
    body: method === "GET" ? undefined : requestBody,
    signal,
  });

  if (!response.ok) {
    const detail = await readError(response);
    throw new Error(`API request failed (${response.status}): ${detail}`);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  try {
    return (await response.json()) as T;
  } catch {
    return undefined as T;
  }
}

export function createFormData(payload: Record<string, any> = {}, files?: File | File[] | FileList) {
  if (typeof FormData === "undefined") {
    throw new Error("FormData is not available in this runtime.");
  }
  const formData = new FormData();
  Object.entries(payload).forEach(([key, value]) => {
    if (value === undefined || value === null) return;
    formData.append(key, typeof value === "object" ? JSON.stringify(value) : String(value));
  });

  if (files) {
    const iterable = files instanceof FileList ? Array.from(files) : Array.isArray(files) ? files : [files];
    iterable.forEach((file) => formData.append("files", file));
  }

  return formData;
}
