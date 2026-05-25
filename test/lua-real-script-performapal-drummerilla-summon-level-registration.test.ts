import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const drummerillaCode = "70479321";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasDrummerillaScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${drummerillaCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typePendulum = 0x1000000;
const attributeEarth = 0x10;
const raceBeast = 0x4000;

describe.skipIf(!hasUpstreamScripts || !hasDrummerillaScript)("Lua real script Performapal Drummerilla summon level registration", () => {
  it("restores Pendulum helper, no-tribute summon procedure/cost, and attack-announce trigger metadata", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${drummerillaCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards());
    const source = { readScript(name: string) { return workspace.readScript(name) ?? ""; } };
    const session = createDuel({ seed: 70479321, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [drummerillaCode] }, 1: { main: [] } });
    startDuel(session);
    const drummerilla = requireCard(session, drummerillaCode);
    moveDuelCard(session.state, drummerilla.uid, "hand", 0);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(drummerillaCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 0);
    const restoredDrummerilla = requireCard(restored.session, drummerillaCode);
    expect(restored.session.state.effects.filter((effect) => effect.sourceUid === restoredDrummerilla.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      event: effect.event,
      property: effect.property,
      range: effect.range,
      sourceUid: effect.sourceUid,
      triggerEvent: effect.triggerEvent,
    }))).toEqual([
      { category: undefined, code: 320, event: "continuous", property: 263168, range: ["spellTrapZone"], sourceUid: restoredDrummerilla.uid, triggerEvent: undefined },
      { category: undefined, code: 1002, event: "ignition", property: undefined, range: ["hand"], sourceUid: restoredDrummerilla.uid, triggerEvent: undefined },
      { category: 2097152, code: 1130, event: "trigger", property: 16, range: ["spellTrapZone"], sourceUid: restoredDrummerilla.uid, triggerEvent: "attackDeclared" },
      { category: undefined, code: 32, event: "continuous", property: 262144, range: ["hand"], sourceUid: restoredDrummerilla.uid, triggerEvent: undefined },
      { category: undefined, code: 91, event: "continuous", property: undefined, range: ["hand"], sourceUid: restoredDrummerilla.uid, triggerEvent: undefined },
      { category: 2097152, code: 1130, event: "trigger", property: 16, range: ["monsterZone"], sourceUid: restoredDrummerilla.uid, triggerEvent: "attackDeclared" },
    ]);
  });
});

function cards(): DuelCardData[] {
  return [
    {
      code: drummerillaCode,
      name: "Performapal Drummerilla",
      kind: "monster",
      typeFlags: typeMonster | typeEffect | typePendulum,
      race: raceBeast,
      attribute: attributeEarth,
      level: 5,
      attack: 1600,
      defense: 900,
      leftScale: 2,
      rightScale: 2,
    },
  ];
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Performapal Drummerilla");
  expect(script).toContain("Pendulum.AddProcedure(c)");
  expect(script).toContain("e1:SetCode(EVENT_ATTACK_ANNOUNCE)");
  expect(script).toContain("Duel.SetTargetCard(tc)");
  expect(script).toContain("e2:SetCode(EFFECT_SUMMON_PROC)");
  expect(script).toContain("Duel.GetFieldGroupCount(c:GetControler(),LOCATION_MZONE,LOCATION_MZONE)==0");
  expect(script).toContain("e3:SetCode(EFFECT_SUMMON_COST)");
  expect(script).toContain("e1:SetCode(EFFECT_CHANGE_LEVEL)");
  expect(script).toContain("e1:SetValue(4)");
  expect(script).toContain("e4:SetRange(LOCATION_MZONE)");
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function expectCleanRestore(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
  expect(restored.missingRegistryKeys).toEqual([]);
  expect(restored.missingChainLimitRegistryKeys).toEqual([]);
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: PlayerId): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}
