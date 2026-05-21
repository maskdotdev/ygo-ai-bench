import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const accesscodeCode = "86066372";
const linkCostCode = "860663720";
const opponentTargetCode = "860663721";
const secondLinkCostCode = "860663722";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasAccesscodeScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${accesscodeCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeSpell = 0x2;
const typeLink = 0x4000000;
const raceCyberse = 0x1000000;
const attributeDark = 0x20;
const attributeLight = 0x10;
const summonTypeLink = 0x4c000000;

describe.skipIf(!hasUpstreamScripts || !hasAccesscodeScript)("Lua real script Accesscode Talker link cost destroy", () => {
  it("restores Link-attribute cost banish into opponent-card destruction and used-attribute flag", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${accesscodeCode}.lua`);
    expect(script).toContain("Link.AddProcedure(c,aux.FilterBoolFunctionEx(Card.IsType,TYPE_EFFECT),2)");
    expect(script).toContain("e0:SetCode(EFFECT_MATERIAL_CHECK)");
    expect(script).toContain("e1:SetCode(EVENT_SPSUMMON_SUCCESS)");
    expect(script).toContain("e1:SetLabelObject(e0)");
    expect(script).toContain("e2:SetCategory(CATEGORY_DESTROY)");
    expect(script).toContain("e2:SetType(EFFECT_TYPE_IGNITION)");
    expect(script).toContain("e2:SetRange(LOCATION_MZONE)");
    expect(script).toContain("e2:SetCost(s.descost)");
    expect(script).toContain("s.attr_list[0]=0");
    expect(script).toContain("s.attr_list[1]=0");
    expect(script).toContain("return c:IsLinkMonster() and c:IsAbleToRemoveAsCost() and s.attr_list[tp]&attr==0");
    expect(script).toContain("Duel.SelectMatchingCard(tp,s.costfilter,tp,LOCATION_MZONE|LOCATION_GRAVE,0,1,1,nil,e,tp)");
    expect(script).toContain("e:SetLabel(g:GetFirst():GetAttribute())");
    expect(script).toContain("Duel.Remove(g,POS_FACEUP,REASON_COST)");
    expect(script).toContain("Duel.GetMatchingGroup(nil,tp,0,LOCATION_ONFIELD,nil)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_DESTROY,g,1,0,0)");
    expect(script).toContain("Duel.SetChainLimit(s.chlimit)");
    expect(script).toContain("Duel.SelectMatchingCard(tp,nil,tp,0,LOCATION_ONFIELD,1,1,nil)");
    expect(script).toContain("Duel.HintSelection(g,true)");
    expect(script).toContain("Duel.Destroy(g,REASON_EFFECT)");
    expect(script).toContain("s.attr_list[tp]=s.attr_list[tp]|att");
    expect(script).toContain("e:GetHandler():RegisterFlagEffect(0,RESETS_STANDARD_PHASE_END,EFFECT_FLAG_CLIENT_HINT,1,0,str)");

    const reader = createCardReader(cards());
    const session = createDuel({ seed: 86066372, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [accesscodeCode, linkCostCode, secondLinkCostCode] }, 1: { main: [opponentTargetCode] } });
    startDuel(session);
    const accesscode = requireCard(session, accesscodeCode);
    const linkCost = requireCard(session, linkCostCode);
    const secondLinkCost = requireCard(session, secondLinkCostCode);
    const opponentTarget = requireCard(session, opponentTargetCode);
    moveFaceUpAttack(session, accesscode, 0, 0);
    accesscode.summonType = "special";
    accesscode.summonTypeCode = summonTypeLink;
    moveDuelCard(session.state, linkCost.uid, "graveyard", 0);
    linkCost.faceUp = true;
    linkCost.position = "faceUpAttack";
    moveDuelCard(session.state, secondLinkCost.uid, "graveyard", 0);
    secondLinkCost.faceUp = true;
    secondLinkCost.position = "faceUpAttack";
    moveFaceUpSpell(session, opponentTarget, 1, 0);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(accesscodeCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 0);
    const action = getLuaRestoreLegalActions(restored, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === accesscode.uid);
    expect(action, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    expect(JSON.stringify(action)).not.toContain("operationInfos");
    applyRestoredActionAndAssert(restored, action!);
    passRestoredChain(restored);

    expect(restored.session.state.cards.find((card) => card.uid === accesscode.uid)).toMatchObject({
      location: "banished",
      controller: 0,
      faceUp: true,
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: accesscode.uid,
      reasonEffectId: 4,
    });
    for (const unusedCost of [linkCost, secondLinkCost]) {
      expect(restored.session.state.cards.find((card) => card.uid === unusedCost.uid)).toMatchObject({
        location: "graveyard",
        controller: 0,
      });
    }
    expect(restored.session.state.cards.find((card) => card.uid === secondLinkCost.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
    });
    expect(restored.session.state.cards.find((card) => card.uid === opponentTarget.uid)).toMatchObject({
      location: "graveyard",
      controller: 1,
      reason: duelReason.effect | duelReason.destroy,
      reasonPlayer: 0,
      reasonCardUid: accesscode.uid,
      reasonEffectId: 4,
    });
    expect(restored.session.state.flagEffects.filter((flag) => flag.ownerType === "card" && flag.ownerId === accesscode.uid).map((flag) => ({
      code: flag.code,
      property: flag.property,
      reset: flag.reset,
      value: flag.value,
    }))).toEqual([
      { code: 0, property: 0x4000000, reset: 1107169792, value: 0 },
    ]);
    expect(restored.session.state.eventHistory.filter((event) => ["banished", "destroyed", "sentToGraveyard"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      previousLocation: event.eventPreviousState?.location,
      currentLocation: event.eventCurrentState?.location,
    }))).toEqual([
      { eventName: "banished", eventCode: 1011, eventCardUid: accesscode.uid, eventReason: duelReason.cost, eventReasonPlayer: 0, eventReasonCardUid: accesscode.uid, eventReasonEffectId: 4, previousLocation: "monsterZone", currentLocation: "banished" },
      { eventName: "destroyed", eventCode: 1029, eventCardUid: opponentTarget.uid, eventReason: duelReason.effect | duelReason.destroy, eventReasonPlayer: 0, eventReasonCardUid: accesscode.uid, eventReasonEffectId: 4, previousLocation: "spellTrapZone", currentLocation: "graveyard" },
      { eventName: "sentToGraveyard", eventCode: 1014, eventCardUid: opponentTarget.uid, eventReason: duelReason.effect | duelReason.destroy, eventReasonPlayer: 0, eventReasonCardUid: accesscode.uid, eventReasonEffectId: 4, previousLocation: "spellTrapZone", currentLocation: "graveyard" },
    ]);
  });
});

function cards(): DuelCardData[] {
  return [
    { code: accesscodeCode, name: "Accesscode Talker", kind: "extra", typeFlags: typeMonster | typeEffect | typeLink, race: raceCyberse, attribute: attributeDark, level: 4, attack: 2300, defense: 0, linkMarkers: 0x2b },
    { code: linkCostCode, name: "Accesscode DARK Link Cost", kind: "extra", typeFlags: typeMonster | typeEffect | typeLink, race: raceCyberse, attribute: attributeDark, level: 2, attack: 1600, defense: 0, linkMarkers: 0x3 },
    { code: secondLinkCostCode, name: "Accesscode LIGHT Link Decoy", kind: "extra", typeFlags: typeMonster | typeEffect | typeLink, race: raceCyberse, attribute: attributeLight, level: 2, attack: 1600, defense: 0, linkMarkers: 0x3 },
    { code: opponentTargetCode, name: "Accesscode Destroy Target", kind: "spell", typeFlags: typeSpell },
  ];
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.sequence = sequence;
  moved.faceUp = true;
  moved.position = "faceUpAttack";
}

function moveFaceUpSpell(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): void {
  const moved = moveDuelCard(session.state, card.uid, "spellTrapZone", player);
  moved.sequence = sequence;
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

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = response.state.waitingFor as PlayerId | undefined;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}

function passRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}
