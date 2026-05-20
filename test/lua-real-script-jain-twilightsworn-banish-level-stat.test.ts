import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack, currentDefense } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const jainCode = "84673417";
const hasJainScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${jainCode}.lua`));
const lightswornCostCode = "846734170";
const targetCode = "846734171";
const typeMonster = 0x1;
const typeEffect = 0x20;
const setLightsworn = 0x38;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasJainScript)("Lua real script Jain Twilightsworn banish level stat", () => {
  it("restores cost banish level label into targeted ATK/DEF reduction", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${jainCode}.lua`);
    expect(script).toContain("e1:SetCategory(CATEGORY_ATKCHANGE+CATEGORY_DEFCHANGE)");
    expect(script).toContain("e1:SetType(EFFECT_TYPE_IGNITION)");
    expect(script).toContain("return c:IsSetCard(SET_LIGHTSWORN) and c:IsLevelAbove(1) and c:IsAbleToRemoveAsCost()");
    expect(script).toContain("e:SetLabel(g:GetFirst():GetLevel())");
    expect(script).toContain("Duel.Remove(g,POS_FACEUP,REASON_COST)");
    expect(script).toContain("Duel.SelectTarget(tp,Card.IsFaceup,tp,LOCATION_MZONE,LOCATION_MZONE,1,1,nil)");
    expect(script).toContain("local lv=e:GetLabel()");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e1:SetValue(-lv*300)");
    expect(script).toContain("e2:SetCode(EFFECT_UPDATE_DEFENSE)");
    expect(script).toContain("e2:SetCode(EVENT_CHAINING)");
    expect(script).toContain("Duel.DiscardDeck(tp,2,REASON_EFFECT)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === jainCode),
      { code: lightswornCostCode, name: "Jain Lightsworn Level Cost", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setLightsworn], level: 4, attack: 1700, defense: 1000 },
      { code: targetCode, name: "Jain Stat Reduction Target", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 2400, defense: 1800 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 84673417, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [jainCode, lightswornCostCode, targetCode] }, 1: { main: [] } });
    startDuel(session);

    const jain = requireCard(session, jainCode);
    const cost = requireCard(session, lightswornCostCode);
    const target = requireCard(session, targetCode);
    moveDuelCard(session.state, target.uid, "monsterZone", 0).position = "faceUpAttack";
    target.faceUp = true;
    moveDuelCard(session.state, jain.uid, "monsterZone", 0).sequence = 1;
    jain.position = "faceUpAttack";
    jain.faceUp = true;
    moveDuelCard(session.state, cost.uid, "graveyard", 0).position = "faceUpAttack";
    cost.faceUp = true;
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(jainCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const action = getLuaRestoreLegalActions(restoredOpen, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === jain.uid);
    expect(action, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredOpen, action!);

    expect(restoredOpen.session.state.chain).toEqual([]);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === cost.uid)).toMatchObject({
      location: "banished",
      controller: 0,
      faceUp: true,
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: jain.uid,
      reasonEffectId: 1,
    });
    const reduced = restoredOpen.session.state.cards.find((card) => card.uid === target.uid);
    expect(currentAttack(reduced, restoredOpen.session.state)).toBe(1200);
    expect(currentDefense(reduced, restoredOpen.session.state)).toBe(600);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === target.uid && (effect.code === 100 || effect.code === 104)).map((effect) => ({
      code: effect.code,
      controller: effect.controller,
      event: effect.event,
      range: effect.range,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: 100, controller: 0, event: "continuous", range: ["monsterZone"], reset: { flags: 1107169792 }, sourceUid: target.uid, value: -1200 },
      { code: 104, controller: 0, event: "continuous", range: ["monsterZone"], reset: { flags: 1107169792 }, sourceUid: target.uid, value: -1200 },
    ]);
    expect(restoredOpen.session.state.eventHistory.filter((event) => event.eventName === "banished" || event.eventName === "becameTarget")).toEqual([
      {
        eventName: "banished",
        eventCode: 1011,
        eventCardUid: cost.uid,
        eventReason: duelReason.cost,
        eventReasonPlayer: 0,
        eventReasonCardUid: jain.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 0, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "banished", position: "faceUpAttack", sequence: 0 },
      },
      {
        eventName: "becameTarget",
        eventCode: 1028,
        eventCardUid: target.uid,
        eventReason: 0,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        relatedEffectId: 1,
        eventChainDepth: 1,
        eventChainLinkId: "chain-3",
      },
    ]);
    expect(restoredOpen.session.state.chain.flatMap((link) => link.operationInfos ?? [])).toEqual([]);
  });
});

function requireCard(session: DuelSession, code: string) {
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

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}
