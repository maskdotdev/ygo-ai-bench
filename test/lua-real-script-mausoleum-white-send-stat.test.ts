import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack, currentDefense } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const mausoleumCode = "24382602";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasMausoleumScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${mausoleumCode}.lua`));
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeNormal = 0x10;
const typeField = 0x80000;
const typeTuner = 0x1000;
const attributeLight = 0x10;

describe.skipIf(!hasUpstreamScripts || !hasMausoleumScript)("Lua real script Mausoleum of White send stat", () => {
  it("restores extra summon count metadata and Normal Monster send-to-grave stat gain", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const targetCode = "243826020";
    const normalMonsterCode = "243826021";
    const tunerCode = "243826022";
    const script = workspace.readScript(`official/c${mausoleumCode}.lua`);
    expect(script).toContain("e1:SetCode(EFFECT_EXTRA_SUMMON_COUNT)");
    expect(script).toContain("e1:SetTargetRange(LOCATION_HAND|LOCATION_MZONE,0)");
    expect(script).toContain("return c:IsLevel(1) and c:IsAttribute(ATTRIBUTE_LIGHT) and c:IsType(TYPE_TUNER)");
    expect(script).toContain("e2:SetCategory(CATEGORY_TOGRAVE+CATEGORY_ATKCHANGE+CATEGORY_DEFCHANGE)");
    expect(script).toContain("e2:SetProperty(EFFECT_FLAG_CARD_TARGET)");
    expect(script).toContain("Duel.SelectTarget(tp,Card.IsFaceup,tp,LOCATION_MZONE,0,1,1,nil)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_TOGRAVE,nil,1,tp,LOCATION_HAND|LOCATION_DECK)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_ATKCHANGE,g,1,tp,100)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_DEFCHANGE,g,1,tp,100)");
    expect(script).toContain("Duel.SelectMatchingCard(tp,s.tgfilter,tp,LOCATION_HAND|LOCATION_DECK,0,1,1,nil)");
    expect(script).toContain("Duel.SendtoGrave(sc,REASON_EFFECT)");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e1:SetValue(sc:GetLevel()*100)");
    expect(script).toContain("e2:SetCode(EFFECT_UPDATE_DEFENSE)");
    expect(script).toContain("e3:SetCost(Cost.SelfBanish)");
    expect(script).toContain("Duel.SelectMatchingCard(tp,s.thfilter,tp,LOCATION_DECK,0,1,1,nil)");

    const cards: DuelCardData[] = [
      { code: mausoleumCode, name: "Mausoleum of White", kind: "spell", typeFlags: typeSpell | typeField },
      { code: targetCode, name: "Mausoleum Stat Target", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1500, defense: 1200 },
      { code: normalMonsterCode, name: "Mausoleum Normal Monster", kind: "monster", typeFlags: typeMonster | typeNormal, level: 4, attack: 1000, defense: 1000 },
      { code: tunerCode, name: "Mausoleum LIGHT Tuner", kind: "monster", typeFlags: typeMonster | typeTuner, attribute: attributeLight, level: 1, attack: 500, defense: 500 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 24382602, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [mausoleumCode, targetCode, normalMonsterCode, tunerCode] }, 1: { main: [] } });
    startDuel(session);

    const mausoleum = requireCard(session, mausoleumCode);
    const target = requireCard(session, targetCode);
    const normalMonster = requireCard(session, normalMonsterCode);
    const tuner = requireCard(session, tunerCode);
    moveDuelCard(session.state, mausoleum.uid, "spellTrapZone", 0).faceUp = true;
    moveFaceUpAttack(session, target, 0);
    moveDuelCard(session.state, tuner.uid, "hand", 0);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(mausoleumCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(session.state.effects.filter((effect) => effect.sourceUid === mausoleum.uid).map((effect) => ({
      code: effect.code,
      event: effect.event,
      range: effect.range,
      targetRange: effect.targetRange,
    }))).toEqual([
      { code: 1002, event: "ignition", range: ["hand", "spellTrapZone"], targetRange: undefined },
      { code: 29, event: "continuous", range: ["spellTrapZone"], targetRange: [2 | 4, 0] },
      { code: undefined, event: "ignition", range: ["spellTrapZone"], targetRange: undefined },
      { code: undefined, event: "ignition", range: ["graveyard"], targetRange: undefined },
    ]);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    expect(getLuaRestoreLegalActions(restoredOpen, 0).some((action) => action.type === "normalSummon" && action.uid === tuner.uid)).toBe(true);
    const statAction = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === mausoleum.uid && action.effectId === "lua-3");
    expect(statAction, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    expect(statAction).not.toHaveProperty("operationInfos");
    applyLuaRestoreAndAssert(restoredOpen, statAction!);
    resolveRestoredChain(restoredOpen);

    expect(restoredOpen.session.state.cards.find((card) => card.uid === normalMonster.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: mausoleum.uid,
      reasonEffectId: 3,
    });
    expect(currentAttack(restoredOpen.session.state.cards.find((card) => card.uid === target.uid), restoredOpen.session.state)).toBe(1900);
    expect(currentDefense(restoredOpen.session.state.cards.find((card) => card.uid === target.uid), restoredOpen.session.state)).toBe(1600);
    expect(restoredOpen.session.state.eventHistory.filter((event) => event.eventName === "sentToGraveyard")).toEqual([
      {
        eventName: "sentToGraveyard",
        eventCode: 1014,
        eventCardUid: normalMonster.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: mausoleum.uid,
        eventReasonEffectId: 3,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
      },
    ]);
  });
});

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
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

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}

function resolveRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restored, pass!);
  }
}
