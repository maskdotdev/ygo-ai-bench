import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { currentLevel } from "#duel/card-stats.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelAction, DuelCardData } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const starChangerCode = "63485233";
const hasStarChangerScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${starChangerCode}.lua`));
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeQuickPlay = 0x10000;

describe.skipIf(!hasUpstreamScripts || !hasStarChangerScript)("Lua real script Star Changer target SelectOption level update", () => {
  it("restores target-time SelectOption into a temporary targeted EFFECT_UPDATE_LEVEL increase", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const targetCode = "634852330";
    const ineligibleCode = "634852331";
    const script = workspace.readScript(`c${starChangerCode}.lua`);
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET)");
    expect(script).toContain("Duel.SelectTarget(tp,s.filter,tp,LOCATION_MZONE,LOCATION_MZONE,1,1,nil)");
    expect(script).toContain("Duel.SelectOption(tp,aux.Stringid(id,0),aux.Stringid(id,1))");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_LEVEL)");
    expect(script).toContain("e1:SetValue(1)");
    expect(script).toContain("e1:SetValue(-1)");

    const cards: DuelCardData[] = [
      { code: starChangerCode, name: "Star Changer", kind: "spell", typeFlags: typeSpell | typeQuickPlay },
      { code: targetCode, name: "Star Changer Level Target", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000 },
      { code: ineligibleCode, name: "Star Changer Level One Decoy", kind: "monster", typeFlags: typeMonster, level: 1, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 63485233, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [starChangerCode, targetCode] }, 1: { main: [ineligibleCode] } });
    startDuel(session);

    const starChanger = requireCard(session, starChangerCode);
    const target = requireCard(session, targetCode);
    const ineligible = requireCard(session, ineligibleCode);
    moveDuelCard(session.state, starChanger.uid, "hand", 0);
    const movedTarget = moveDuelCard(session.state, target.uid, "monsterZone", 0);
    movedTarget.faceUp = true;
    movedTarget.position = "faceUpAttack";
    const movedIneligible = moveDuelCard(session.state, ineligible.uid, "monsterZone", 1);
    movedIneligible.faceUp = true;
    movedIneligible.position = "faceUpAttack";
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(starChangerCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const activation = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === starChanger.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, activation!);
    expect(restoredOpen.session.state.prompt).toBeUndefined();
    expect(restoredOpen.session.state.chain).toEqual([]);
    const restoredTarget = restoredOpen.session.state.cards.find((card) => card.uid === target.uid);
    expect(currentLevel(restoredTarget, restoredOpen.session.state)).toBe(5);
    expect(currentLevel(restoredOpen.session.state.cards.find((card) => card.uid === ineligible.uid), restoredOpen.session.state)).toBe(1);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === starChanger.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    const levelEffects = restoredOpen.session.state.effects
      .filter((effect) => effect.code === 130)
      .map((effect) => ({ code: effect.code, registryKey: effect.registryKey, sourceUid: effect.sourceUid, value: effect.value, reset: effect.reset }));
    expect(levelEffects).toEqual([
      {
        code: 130,
        registryKey: "lua:63485233:lua-2-130",
        sourceUid: target.uid,
        value: 1,
        reset: { flags: 33427456 },
      },
    ]);
    expect(restoredOpen.session.state.eventHistory.filter((event) => event.eventName === "levelChanged")).toEqual([]);

    const restoredLevel = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredLevel);
    expectRestoredLegalActions(restoredLevel, 0);
    expect(currentLevel(restoredLevel.session.state.cards.find((card) => card.uid === target.uid), restoredLevel.session.state)).toBe(5);
    expect(restoredLevel.host.messages).not.toContain("Star Changer target SelectOption failed");
  });
});

function expectCleanRestore(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
  expect(restored.missingRegistryKeys).toEqual([]);
  expect(restored.missingChainLimitRegistryKeys).toEqual([]);
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const result = applyLuaRestoreResponse(restored, action);
  expect(result.ok, result.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(result.legalActions).toEqual(getLegalActions(restored.session, waitingFor));
    expect(result.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, waitingFor));
    expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
  }
}

function requireCard(session: ReturnType<typeof createDuel>, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}
