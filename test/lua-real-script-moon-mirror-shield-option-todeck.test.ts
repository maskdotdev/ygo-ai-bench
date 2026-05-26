import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, sendDuelCardToGraveyard, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const shieldCode = "19508728";
const hasShieldScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${shieldCode}.lua`));
const typeSpell = 0x2;
const typeEquip = 0x40000;

describe.skipIf(!hasUpstreamScripts || !hasShieldScript)("Lua real script Moon Mirror Shield option to-Deck", () => {
  it("restores face-up Equip to-GY trigger LP cost, SelectOption label, and send to Deck", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${shieldCode}.lua`);
    expect(script).toContain("aux.AddEquipProcedure(c)");
    expect(script).toContain("e3:SetCategory(CATEGORY_ATKCHANGE+CATEGORY_DEFCHANGE)");
    expect(script).toContain("e3:SetCode(EVENT_PRE_DAMAGE_CALCULATE)");
    expect(script).toContain("local val=math.max(tc:GetAttack(),tc:GetDefense())");
    expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK_FINAL)");
    expect(script).toContain("e2:SetCode(EFFECT_SET_DEFENSE_FINAL)");
    expect(script).toContain("e4:SetCategory(CATEGORY_TODECK)");
    expect(script).toContain("e4:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_F)");
    expect(script).toContain("e4:SetCode(EVENT_TO_GRAVE)");
    expect(script).toContain("return c:IsPreviousPosition(POS_FACEUP) and c:IsPreviousLocation(LOCATION_ONFIELD)");
    expect(script).toContain("e4:SetCost(Cost.PayLP(500))");
    expect(script).toContain("local opt=Duel.SelectOption(tp,aux.Stringid(id,0),aux.Stringid(id,1))");
    expect(script).toContain("e:SetLabel(opt)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_TODECK,e:GetHandler(),1,0,0)");
    expect(script).toContain("Duel.SendtoDeck(e:GetHandler(),nil,e:GetLabel(),REASON_EFFECT)");

    const cards: DuelCardData[] = [
      { code: shieldCode, name: "Moon Mirror Shield", kind: "spell", typeFlags: typeSpell | typeEquip },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 19508728, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [shieldCode] }, 1: { main: [] } });
    startDuel(session);

    const shield = requireCard(session, shieldCode);
    const placedShield = moveDuelCard(session.state, shield.uid, "spellTrapZone", 0);
    placedShield.faceUp = true;
    placedShield.position = "faceUpAttack";
    session.state.phase = "main1";
    session.state.waitingFor = 0;
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(shieldCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    sendDuelCardToGraveyard(session.state, shield.uid, 0, duelReason.effect, 0);
    expect(session.state.cards.find((card) => card.uid === shield.uid)).toMatchObject({
      location: "graveyard",
      previousLocation: "spellTrapZone",
      previousFaceUp: true,
      reason: duelReason.effect,
    });

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    expect(restoredTrigger.session.state.pendingTriggers).toEqual([
      {
        id: "trigger-3-1",
        effectId: "lua-4-1014",
        eventCardUid: shield.uid,
        eventCode: 1014,
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
        eventName: "sentToGraveyard",
        eventPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: true, location: "spellTrapZone", position: "faceUpAttack", sequence: 0 },
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventTriggerTiming: "when",
        player: 0,
        sourceUid: shield.uid,
        triggerBucket: "turnMandatory",
      },
    ]);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === shield.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredTrigger, trigger!);
    expect(restoredTrigger.session.state.chain.flatMap((link) => link.operationInfos ?? [])).toEqual([]);
    expect(restoredTrigger.session.state.players[0].lifePoints).toBe(7500);
    expect(restoredTrigger.host.promptDecisions).toEqual([
      expect.objectContaining({ api: "SelectOption", player: 0, options: [0, 1], returned: 0 }),
    ]);
    expect(restoredTrigger.session.state.cards.find((card) => card.uid === shield.uid)).toMatchObject({
      location: "deck",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: shield.uid,
      reasonEffectId: 4,
      sequence: 0,
    });
    expect(restoredTrigger.session.state.eventHistory.filter((event) => ["sentToGraveyard", "lifePointCostPaid", "sentToDeck"].includes(event.eventName))).toEqual([
      {
        eventName: "sentToGraveyard",
        eventCode: 1014,
        eventCardUid: shield.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: true, location: "spellTrapZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
      },
      {
        eventName: "lifePointCostPaid",
        eventCode: 1201,
        eventReason: duelReason.cost,
        eventReasonPlayer: 0,
        eventReasonCardUid: shield.uid,
        eventReasonEffectId: 4,
        eventPlayer: 0,
        eventValue: 500,
      },
      {
        eventName: "sentToDeck",
        eventCode: 1013,
        eventCardUid: shield.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: shield.uid,
        eventReasonEffectId: 4,
        eventPreviousState: { controller: 0, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "deck", position: "faceUpAttack", sequence: 0 },
      },
    ]);

    const restoredResolved = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), workspace, reader);
    expectCleanRestore(restoredResolved);
    expectRestoredLegalActions(restoredResolved, 0);
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
  const result = applyLuaRestoreResponse(restored, action);
  expect(result.ok, result.error).toBe(true);
  const player = result.state.waitingFor as PlayerId | undefined;
  if (player === undefined) return;
  expect(result.legalActions).toEqual(getLuaRestoreLegalActions(restored, player));
  expect(result.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, player));
  expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
}
