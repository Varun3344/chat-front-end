const toJson = async (response) => {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
};

export async function clientApiFetch(path, options = {}) {
  const {
    method = "GET",
    body,
    headers = {},
    signal,
  } = options;

  const finalHeaders = {
    Accept: "application/json",
    ...headers,
  };

  let serializedBody;
  if (body !== undefined) {
    finalHeaders["Content-Type"] = "application/json";
    serializedBody = JSON.stringify(body);
  }

  const response = await fetch(path, {
    method,
    headers: finalHeaders,
    body: serializedBody,
    signal,
  });

  const payload = await toJson(response);

  if (!response.ok) {
    const detail = payload?.message ?? `Request failed (${response.status}).`;
    throw new Error(detail);
  }

  return payload?.data ?? payload;
}
