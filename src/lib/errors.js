export function httpErrorMessage(err) {
  if (!err) return "Unknown error";

  if (err instanceof Error && err.message) {
    const m = String(err.message).trim();
    if (m && m !== "[object Object]") return m;
  }

  if (typeof err === "object") {
    const parts = [];
    if (err.message != null) parts.push(String(err.message));
    if (err.details != null) parts.push(String(err.details));
    if (err.hint != null) parts.push(String(err.hint));
    if (err.code != null) parts.push(`code: ${err.code}`);

    if (parts.length > 0) {
      return parts.join(" | ");
    }

    try {
      const str = JSON.stringify(err);
      if (str !== "{}") return str;
    } catch {
      /* ignore */
    }
  }

  if (typeof err === "string") return err;

  return "Internal server error";
}

export function toError(err) {
  return new Error(httpErrorMessage(err));
}
