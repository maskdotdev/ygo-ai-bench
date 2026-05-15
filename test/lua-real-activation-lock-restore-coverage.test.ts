import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const activationLockFixtureCount = 3;
const activationLockAllowListFixtureCount = 2;
const activationLockVariantFixtureCount = 14;

describe("Lua real activation-lock restore coverage", () => {
  it("requires representative activation-lock fixtures to assert clean Lua registry restore", () => {
    const files = realScriptActivationLockFixtureFiles();
    expect(files).toHaveLength(activationLockFixtureCount);

    const missing = files
      .filter((file) => {
        const text = fs.readFileSync(path.join(root, file), "utf8");
        return !text.includes("restoreComplete")
          || !text.includes('incompleteReasons.join("; ")')
          || !text.includes("missingRegistryKeys")
          || !text.includes("missingRegistryKeys).toEqual([])")
          || !text.includes("missingChainLimitRegistryKeys).toEqual([])");
      });

    expect(missing).toEqual([]);
  });

  it("requires representative activation-lock fixtures to prove restored lock effects and legal-action filtering", () => {
    const files = realScriptActivationLockFixtureFiles();
    expect(files).toHaveLength(activationLockFixtureCount);

    const missing = files
      .filter((file) => {
        const text = fs.readFileSync(path.join(root, file), "utf8");
        return !text.includes("code === 6")
          || !text.includes('event: "continuous"')
          || !text.includes("targetRange")
          || !text.includes("getLuaRestoreLegalActions")
          || !text.includes("activateEffect")
          || !text.includes("toBe(false)");
      });

    expect(missing).toEqual([]);
  });

  it("requires activation-lock fixtures with exclusions to prove allowed actions remain legal", () => {
    const files = realScriptActivationLockAllowListFixtureFiles();
    expect(files).toHaveLength(activationLockAllowListFixtureCount);

    const missing = files
      .filter((file) => {
        const text = fs.readFileSync(path.join(root, file), "utf8");
        return !text.includes("toBe(true)");
      });

    expect(missing).toEqual([]);
  });

  it("requires representative activation-lock variants to prove exact blocked and allowed action classes", () => {
    const fixtures = realScriptActivationLockVariantFixtures();
    expect(fixtures).toHaveLength(activationLockVariantFixtureCount);

    const missing = fixtures
      .filter((fixture) => {
        const text = fs.readFileSync(path.join(root, fixture.file), "utf8");
        return !text.includes("restoreComplete")
          || !text.includes('incompleteReasons.join("; ")')
          || !text.includes("missingRegistryKeys")
          || !text.includes("missingRegistryKeys).toEqual([])")
          || !text.includes("missingChainLimitRegistryKeys).toEqual([])")
          || !fixture.requiredSnippets.every((snippet) => text.includes(snippet));
      })
      .map((fixture) => fixture.file);

    expect(missing).toEqual([]);
  });
});

function realScriptActivationLockFixtureFiles(): string[] {
  return [
    "lua-real-script-cold-wave-spelltrap-activation-lock.test.ts",
    "lua-real-script-sangan-same-code-activation-lock.test.ts",
    "lua-real-script-wattgiraffe-battle-activation-lock.test.ts",
  ]
    .map((file) => path.join("test", file))
    .sort();
}

function realScriptActivationLockAllowListFixtureFiles(): string[] {
  return realScriptActivationLockFixtureFiles()
    .filter((file) => !file.endsWith("lua-real-script-wattgiraffe-battle-activation-lock.test.ts"));
}

function realScriptActivationLockVariantFixtures(): Array<{ file: string; requiredSnippets: string[] }> {
  return [
    {
      file: "test/lua-real-script-lunalight-kaleido-chick-remove-activation-lock.test.ts",
      requiredSnippets: [
        "restoredTrigger.missingRegistryKeys).toEqual([])",
        "restoredTrigger.missingChainLimitRegistryKeys).toEqual([])",
        "restoredLock.missingRegistryKeys).toEqual([])",
        "restoredLock.missingChainLimitRegistryKeys).toEqual([])",
        "effect.code === 6",
        "targetRange: [0, 1]",
        "action.uid === opponentSpell.uid)).toBe(false)",
        "action.uid === responder.uid)).toBe(false)",
      ],
    },
    {
      file: "test/lua-real-script-ultimate-falcon-activation-lock.test.ts",
      requiredSnippets: [
        "restored.missingRegistryKeys).toEqual([])",
        "restored.missingChainLimitRegistryKeys).toEqual([])",
        "restoredLock.missingRegistryKeys).toEqual([])",
        "restoredLock.missingChainLimitRegistryKeys).toEqual([])",
        "currentAttack(",
        "effect.code === 6",
        "targetRange: [0, 1]",
        "action.uid === responder.uid)).toBe(false)",
        "host.messages).not.toContain",
      ],
    },
    {
      file: "test/lua-real-script-amano-iwato-activation-lock.test.ts",
      requiredSnippets: [
        'luaValueDescriptor: "cannot-activate:non-spirit-monster-effect"',
        'action.uid === blockedMonster!.uid)).toBe(false)',
        'action.uid === allowedSpirit!.uid)',
        'host.messages).toContain("allowed Spirit resolved")',
        'host.messages).not.toContain("blocked monster resolved")',
      ],
    },
    {
      file: "test/lua-real-script-aussa-channeler-attribute-activation-lock.test.ts",
      requiredSnippets: [
        'luaValueDescriptor: "cannot-activate:monster-attribute-except:1"',
        'action.uid === fireResponder.uid)).toBe(false)',
        'action.uid === earthResponder.uid)).toBe(true)',
      ],
    },
    {
      file: "test/lua-real-script-inzektor-axe-damage-phase-activation-lock.test.ts",
      requiredSnippets: [
        'luaValueDescriptor: "cannot-activate:card-activation"',
        'reset: { flags: 0x40000020 }',
        'action.uid === spell.uid)).toBe(false)',
        'action.uid === responder.uid)).toBe(true)',
      ],
    },
    {
      file: "test/lua-real-script-vernusylph-attribute-activation-lock.test.ts",
      requiredSnippets: [
        'luaValueDescriptor: "cannot-activate:monster-attribute-except:1"',
        'action.uid === fireResponder.uid)).toBe(false)',
        'action.uid === earthResponder.uid)).toBe(true)',
      ],
    },
    {
      file: "test/lua-real-script-eria-channeler-attribute-activation-lock.test.ts",
      requiredSnippets: [
        'luaValueDescriptor: "cannot-activate:monster-attribute-except:2"',
        'action.uid === fireResponder.uid)).toBe(false)',
        'action.uid === waterResponder.uid)).toBe(true)',
      ],
    },
    {
      file: "test/lua-real-script-hiita-channeler-attribute-activation-lock.test.ts",
      requiredSnippets: [
        'luaValueDescriptor: "cannot-activate:monster-attribute-except:4"',
        'action.uid === windResponder.uid)).toBe(false)',
        'action.uid === fireResponder.uid)).toBe(true)',
      ],
    },
    {
      file: "test/lua-real-script-wynn-channeler-attribute-activation-lock.test.ts",
      requiredSnippets: [
        'luaValueDescriptor: "cannot-activate:monster-attribute-except:8"',
        'action.uid === fireResponder.uid)).toBe(false)',
        'action.uid === windResponder.uid)).toBe(true)',
      ],
    },
    {
      file: "test/lua-real-script-ancient-gear-beast-card-activation-lock.test.ts",
      requiredSnippets: [
        'luaValueDescriptor: "cannot-activate:card-activation"',
        'targetRange: [0, 1]',
        'action.uid === opponentSpell.uid)).toBe(false)',
        'action.uid === responder.uid)).toBe(true)',
      ],
    },
    {
      file: "test/lua-real-script-shopina-light-activation-lock.test.ts",
      requiredSnippets: [
        'luaValueDescriptor: "cannot-activate:monster-attribute-except:16"',
        'action.uid === fireResponder.uid)).toBe(false)',
        'action.uid === lightResponder.uid)).toBe(true)',
        "restoredLock.missingRegistryKeys).toEqual([])",
        "restoredLock.missingChainLimitRegistryKeys).toEqual([])",
      ],
    },
    {
      file: "test/lua-real-script-sasuke-samurai-spelltrap-activation-lock.test.ts",
      requiredSnippets: [
        'luaValueDescriptor: "cannot-activate:spell-trap-effect"',
        'action.uid === opponentSpell.uid)).toBe(false)',
        'action.uid === responder.uid)).toBe(true)',
        "restoredLock.missingRegistryKeys).toEqual([])",
        "restoredLock.missingChainLimitRegistryKeys).toEqual([])",
      ],
    },
    {
      file: "test/lua-real-script-sonic-jammer-spell-activation-lock.test.ts",
      requiredSnippets: [
        'luaValueDescriptor: "cannot-activate:spell-card-activation"',
        'action.uid === spell.uid)).toBe(false)',
        'action.uid === trap.uid)).toBe(true)',
      ],
    },
    {
      file: "test/lua-real-script-timegazer-trap-activation-lock.test.ts",
      requiredSnippets: [
        'luaValueDescriptor: "cannot-activate:trap-card-activation"',
        'action.uid === spell.uid)).toBe(true)',
        'action.uid === trap.uid)).toBe(false)',
      ],
    },
  ].sort((a, b) => a.file.localeCompare(b.file));
}
