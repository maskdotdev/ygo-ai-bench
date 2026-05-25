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
const rainbowCode = "79407975";
const darkCodes = Array.from({ length: 7 }, (_, index) => `79407975${index}`);
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasRainbowScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${rainbowCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const attributeDark = 0x20;
const raceDragon = 0x2000;

describe.skipIf(!hasUpstreamScripts || !hasRainbowScript)("Lua real script Rainbow Dark Dragon registration metadata", () => {
  it("restores summon condition/procedure and DARK banish ATK ignition metadata", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${rainbowCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards());
    const session = createDuel({ seed: 79407975, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [rainbowCode, ...darkCodes] }, 1: { main: [] } });
    startDuel(session);
    const rainbow = requireCard(session, rainbowCode);
    moveDuelCard(session.state, rainbow.uid, "hand", 0);
    for (const code of darkCodes) {
      moveDuelCard(session.state, requireCard(session, code).uid, "graveyard", 0).faceUp = true;
    }
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(rainbowCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 0);
    expect(restored.session.state.effects.filter((effect) => effect.sourceUid === rainbow.uid).map((effect) => ({
      code: effect.code,
      event: effect.event,
      property: effect.property,
      range: effect.range,
      sourceUid: effect.sourceUid,
    }))).toEqual([
      { code: 31, event: "continuous", property: 263168, range: ["hand"], sourceUid: rainbow.uid },
      { code: 30, event: "continuous", property: 263168, range: ["hand"], sourceUid: rainbow.uid },
      { code: 34, event: "summonProcedure", property: 262144, range: ["hand"], sourceUid: rainbow.uid },
      { code: undefined, event: "ignition", property: undefined, range: ["monsterZone"], sourceUid: rainbow.uid },
    ]);
    expect(getLuaRestoreLegalActions(restored, 0).some((action) => action.type === "specialSummonProcedure" && action.uid === rainbow.uid)).toBe(true);
  });
});

function cards(): DuelCardData[] {
  return [
    { code: rainbowCode, name: "Rainbow Dark Dragon", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceDragon, attribute: attributeDark, level: 10, attack: 4000, defense: 0 },
    ...darkCodes.map((code, index) => ({
      code,
      name: `Rainbow Dark Cost ${index + 1}`,
      kind: "monster" as const,
      typeFlags: typeMonster | typeEffect,
      race: raceDragon,
      attribute: attributeDark,
      level: 4,
      attack: 1000,
      defense: 1000,
    })),
  ];
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Rainbow Dark Dragon");
  expect(script).toContain("e1:SetCode(EFFECT_SPSUMMON_CONDITION)");
  expect(script).toContain("e2:SetCode(EFFECT_SPSUMMON_PROC)");
  expect(script).toContain("aux.SelectUnselectGroup(rg,e,tp,7,7,s.rescon,0)");
  expect(script).toContain("Duel.Remove(g,POS_FACEUP,REASON_COST)");
  expect(script).toContain("e3:SetCategory(CATEGORY_ATKCHANGE)");
  expect(script).toContain("e:SetLabel(#g)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(e:GetLabel()*500)");
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
