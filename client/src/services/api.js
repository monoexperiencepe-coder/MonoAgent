const BASE_URL =
  import.meta.env.VITE_API_URL ?? (import.meta.env.DEV ? "http://localhost:3000" : "");

export async function sendChat({ message, systemPrompt, faqs }) {
  const res = await fetch(`${BASE_URL}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, systemPrompt, faqs }),
  });

  let data = {};
  try {
    data = await res.json();
  } catch {
    /* ignore */
  }

  if (!res.ok) {
    throw new Error(data.error || `Error ${res.status}`);
  }

  return data;
}
