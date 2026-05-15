import fs from "node:fs";

const bridgePath = bridgePathArg() ?? "dist/playtest-engine.js";
const maxBytes = maxBytesArg() ?? 128 * 1024;
const forbiddenSnippets = ["child_process", "readline-sync", "node_modules/fengari", "Module \"fs\"", "from \"fs\"", "require(\"fs\")"];
const requiredSnippets = requiredSnippetArgs();

if (!fs.existsSync(bridgePath)) {
  console.error(`${bridgePath} does not exist. Run the bridge build before checking it.`);
  process.exit(1);
}

const source = fs.readFileSync(bridgePath, "utf8");
const size = Buffer.byteLength(source);
const forbidden = forbiddenSnippets.filter((snippet) => source.includes(snippet));
const missing = requiredSnippets.filter((snippet) => !source.includes(snippet));

if (size > maxBytes || forbidden.length > 0 || missing.length > 0) {
  if (size > maxBytes) console.error(`${bridgePath} is ${size} bytes, expected at most ${maxBytes}.`);
  if (forbidden.length > 0) console.error(`${bridgePath} contains Node-facing snippets: ${forbidden.join(", ")}`);
  if (missing.length > 0) console.error(`${bridgePath} is missing browser bridge API snippets: ${missing.join(", ")}`);
  process.exit(1);
}

console.log(`Bridge bundle check passed. ${bridgePath} is ${size} bytes.`);

function bridgePathArg() {
  const index = process.argv.indexOf("--bridge");
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) {
    console.error("Missing value for --bridge");
    process.exit(1);
  }
  return value;
}

function maxBytesArg() {
  const index = process.argv.indexOf("--max-bytes");
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  const parsed = Number(value);
  if (!value || value.startsWith("--") || !Number.isSafeInteger(parsed) || parsed <= 0) {
    console.error("Missing or invalid value for --max-bytes");
    process.exit(1);
  }
  return parsed;
}

function requiredSnippetArgs() {
  const snippets = [];
  for (let index = 0; index < process.argv.length; index += 1) {
    if (process.argv[index] !== "--required") continue;
    const value = process.argv[index + 1];
    if (!value || value.startsWith("--")) {
      console.error("Missing value for --required");
      process.exit(1);
    }
    snippets.push(value);
    index += 1;
  }
  return snippets.length > 0 ? snippets : ["window.duelDeckPlaytest", "legalActions", "legalActionGroups", "runScripted"];
}
