import fs from "node:fs";

const bridgePath = "dist/playtest-engine.js";
const maxBytes = 128 * 1024;
const forbiddenSnippets = ["child_process", "readline-sync", "node_modules/fengari", "Module \"fs\"", "from \"fs\"", "require(\"fs\")"];
const requiredSnippets = ["window.duelDeckPlaytest", "legalActions", "legalActionGroups", "runScripted"];

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
