/**
 * AGY's documented NDJSON input avoids putting the entire chat on Windows'
 * command line (CreateProcess rejects long argv before the agent can start).
 * Keep the existing output protocol and permission flags; send exactly one
 * user turn, then EOF. Plain-output AGY runs and other CLIs are unchanged.
 * https://antigravity.google/docs/cli/headless/#stream-prompts-from-stdin
 *
 * @param {string} cliId
 * @param {string[]} args
 * @returns {{args: string[], stdin: string | null}}
 */
export function prepareCliInput(cliId, args) {
  const output = args.indexOf("--output-format");
  if (cliId !== "antigravity" || output < 0 || args[output + 1] !== "stream-json") {
    return { args, stdin: null };
  }
  const print = args.findIndex(arg => ["-p", "--print", "--prompt"].includes(arg));
  if (print < 0 || typeof args[print + 1] !== "string") return { args, stdin: null };
  const prompt = args[print + 1];
  const rest = [...args.slice(0, print), ...args.slice(print + 2)];
  if (rest.includes("--input-format")) {
    throw new Error("AGY invocation cannot combine a print prompt with an explicit input format");
  }
  return {
    args: [...rest, "--input-format", "stream-json"],
    stdin: JSON.stringify({ event: "user", message: { content: prompt } }) + "\n",
  };
}
