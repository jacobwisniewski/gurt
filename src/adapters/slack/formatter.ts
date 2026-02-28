export function formatResponse(text: string): string {
  const MAX_LENGTH = 3000;
  if (text.length > MAX_LENGTH) {
    return (
      text.substring(0, MAX_LENGTH - 100) +
      "\n\n... (truncated, use a file attachment for full output)"
    );
  }
  return text;
}

export function extractResponseText(data: { parts?: Array<{ type: string; text?: string }> }): string {
  if (!data.parts || data.parts.length === 0) {
    return "No response";
  }

  return data.parts
    .filter((part: { type: string }) => part.type === "text")
    .map((part: { text?: string }) => part.text || "")
    .join("\n");
}
