import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentLevel } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const typeMonster = 0x1;
const effectChangeLevelFinal = 314;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Star Light, Star Bright group Level final", () => {
  it("restores operation-registered final Level changes for monsters matching target ATK or DEF", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const starLightCode = "43661068";
    const targetCode = "4366106801";
    const sameAttackCode = "4366106802";
    const sameDefenseCode = "4366106803";
    const decoyCode = "4366106804";
    const script = workspace.readScript(`c${starLightCode}.lua`);
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET)");
    expect(script).toContain("Duel.SelectTarget(tp,s.tfilter,tp,LOCATION_MZONE,0,1,1,nil,tp)");
    expect(script).toContain("Duel.GetMatchingGroup(s.filter,tp,LOCATION_MZONE,0,tc,tc:GetAttack(),tc:GetDefense())");
    expect(script).toContain("for lc in aux.Next(g) do");
    expect(script).toContain("e1:SetCode(EFFECT_CHANGE_LEVEL_FINAL)");
    expect(script).toContain("e1:SetValue(lv)");
    expect(script).toContain("e1:SetReset(RESETS_STANDARD_PHASE_END)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === starLightCode),
      { code: targetCode, name: "Star Light Level 7 Target", kind: "monster", typeFlags: typeMonster, level: 7, attack: 1500, defense: 1000 },
      { code: sameAttackCode, name: "Star Light Same ATK Ally", kind: "monster", typeFlags: typeMonster, level: 3, attack: 1500, defense: 800 },
      { code: sameDefenseCode, name: "Star Light Same DEF Ally", kind: "monster", typeFlags: typeMonster, level: 4, attack: 900, defense: 1000 },
      { code: decoyCode, name: "Star Light Nonmatching Decoy", kind: "monster", typeFlags: typeMonster, level: 2, attack: 1100, defense: 1100 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 4366, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [starLightCode, targetCode, sameAttackCode, sameDefenseCode, decoyCode] }, 1: { main: [] } });
    startDuel(session);

    const starLight = requireCard(session, starLightCode);
    const target = requireCard(session, targetCode);
    const sameAttack = requireCard(session, sameAttackCode);
    const sameDefense = requireCard(session, sameDefenseCode);
    const decoy = requireCard(session, decoyCode);
    moveDuelCard(session.state, starLight.uid, "hand", 0);
    moveFaceUpAttack(session, target, 0);
    moveFaceUpAttack(session, sameAttack, 0);
    moveFaceUpAttack(session, sameDefense, 0);
    moveFaceUpAttack(session, decoy, 0);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(starLightCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const activation = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === starLight.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    expect(("operationInfos" in activation! ? activation.operationInfos : []) ?? []).toEqual([]);
    applyRestoredActionAndAssert(restoredOpen, activation!);
    expect(restoredOpen.session.state.chain).toEqual([]);

    expect(currentLevel(restoredOpen.session.state.cards.find((card) => card.uid === target.uid), restoredOpen.session.state)).toBe(7);
    expect(currentLevel(restoredOpen.session.state.cards.find((card) => card.uid === sameAttack.uid), restoredOpen.session.state)).toBe(7);
    expect(currentLevel(restoredOpen.session.state.cards.find((card) => card.uid === sameDefense.uid), restoredOpen.session.state)).toBe(7);
    expect(currentLevel(restoredOpen.session.state.cards.find((card) => card.uid === decoy.uid), restoredOpen.session.state)).toBe(2);
    expect(restoredOpen.session.state.eventHistory.some((event) => event.eventName === "levelChanged")).toBe(false);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.code === effectChangeLevelFinal).map((effect) => ({
      code: effect.code,
      event: effect.event,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectChangeLevelFinal, event: "continuous", sourceUid: sameAttack.uid, value: 7 },
      { code: effectChangeLevelFinal, event: "continuous", sourceUid: sameDefense.uid, value: 7 },
    ]);

    const restoredLevelFinal = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredLevelFinal);
    expectRestoredLegalActions(restoredLevelFinal, 0);
    expect(currentLevel(restoredLevelFinal.session.state.cards.find((card) => card.uid === sameAttack.uid), restoredLevelFinal.session.state)).toBe(7);
    expect(currentLevel(restoredLevelFinal.session.state.cards.find((card) => card.uid === sameDefense.uid), restoredLevelFinal.session.state)).toBe(7);
    expect(currentLevel(restoredLevelFinal.session.state.cards.find((card) => card.uid === decoy.uid), restoredLevelFinal.session.state)).toBe(2);
    expect(restoredLevelFinal.host.messages).not.toContain("star light restore failed");
  });
});

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: 0 | 1): void {
  moveDuelCard(session.state, card.uid, "monsterZone", player);
  card.faceUp = true;
  card.position = "faceUpAttack";
}

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
    expect(result.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
    expect(result.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
    expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
  }
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}
