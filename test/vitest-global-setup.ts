import fs from "node:fs";

import { prepareVitestTempRoot, vitestTempRoot } from "./vitest-tempdir.js";

export default function setup(): () => void {
  prepareVitestTempRoot(true);

  return () => {
    fs.rmSync(vitestTempRoot, { recursive: true, force: true });
  };
}
