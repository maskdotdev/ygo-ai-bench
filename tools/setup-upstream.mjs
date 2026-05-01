import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const upstreamRoot = path.resolve(".upstream", "ignis");
const scriptRoot = path.join(upstreamRoot, "script");
const databaseRepoRoot = path.join(upstreamRoot, "babelcdb");
const databaseTargetRoot = path.join(upstreamRoot, "cdb");
const databaseTarget = path.join(databaseTargetRoot, "cards.cdb");

syncGitRepo("https://github.com/ProjectIgnis/CardScripts.git", scriptRoot);
syncSparseGitRepo("https://github.com/ProjectIgnis/BabelCDB.git", databaseRepoRoot, ["/cards.cdb"]);

fs.mkdirSync(databaseTargetRoot, { recursive: true });
fs.copyFileSync(path.join(databaseRepoRoot, "cards.cdb"), databaseTarget);

console.log(`Card scripts: ${path.relative(process.cwd(), scriptRoot)}`);
console.log(`Card database: ${path.relative(process.cwd(), databaseTarget)}`);

function syncGitRepo(url, directory) {
  if (fs.existsSync(path.join(directory, ".git"))) {
    run("git", ["-C", directory, "pull", "--ff-only"]);
    return;
  }
  fs.rmSync(directory, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(directory), { recursive: true });
  run("git", ["clone", "--depth", "1", url, directory]);
}

function syncSparseGitRepo(url, directory, sparsePaths) {
  if (fs.existsSync(path.join(directory, ".git"))) {
    run("git", ["-C", directory, "sparse-checkout", "set", "--no-cone", ...sparsePaths]);
    run("git", ["-C", directory, "pull", "--ff-only"]);
    return;
  }
  fs.rmSync(directory, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(directory), { recursive: true });
  run("git", ["clone", "--depth", "1", "--filter=blob:none", "--sparse", url, directory]);
  run("git", ["-C", directory, "sparse-checkout", "set", "--no-cone", ...sparsePaths]);
}

function run(command, args) {
  execFileSync(command, args, { stdio: "inherit" });
}
