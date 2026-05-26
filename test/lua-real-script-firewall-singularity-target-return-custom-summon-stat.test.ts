import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, sendDuelCardToGraveyard, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const firewallCode = "21637210";
const statTypeCode = "216372100";
const returnTargetCode = "216372101";
const linkedSentCode = "216372102";
const graveCyberseCode = "216372103";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasFirewallScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${firewallCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeFusion = 0x40;
const typeLink = 0x4000000;
const raceCyberse = 0x1000000;
const raceWarrior = 0x1;
const attributeDark = 0x20;
const attributeLight = 0x10;
const effectUpdateAttack = 100;
const eventSentToGraveyard = 1014;
const eventCustomFirewall = 0x10000000 + Number(firewallCode);

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasFirewallScript)("Lua real script Firewall Dragon Singularity target return custom summon stat", () => {
  it("restores target return ATK gain and linked-zone to-GY custom Cyberse revive", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${firewallCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards(workspace));
    const source = workspace;

    const restoredReturn = createRestoredFirewallField({ reader, source, workspace });
    expectCleanRestore(restoredReturn);
    expectRestoredLegalActions(restoredReturn, 0);
    const returnFirewall = requireCard(restoredReturn.session, firewallCode);
    const returnTarget = requireCard(restoredReturn.session, returnTargetCode);
    expect(currentAttack(returnFirewall, restoredReturn.session.state)).toBe(3500);
    expect(restoredReturn.session.state.effects.filter((effect) => effect.sourceUid === returnFirewall.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      event: effect.event,
      property: effect.property,
      range: effect.range,
      triggerEvent: effect.triggerEvent,
    }))).toEqual([
      { category: undefined, code: 31, event: "continuous", property: 263168, range: ["monsterZone"], triggerEvent: undefined },
      { category: 2097160, code: 1002, event: "quick", property: 16400, range: ["monsterZone"], triggerEvent: undefined },
      { category: undefined, code: 1140, event: "continuous", property: 0x400, range: ["monsterZone"], triggerEvent: undefined },
      { category: undefined, code: eventSentToGraveyard, event: "continuous", property: 0x400, range: ["monsterZone"], triggerEvent: undefined },
      { category: 512, code: eventCustomFirewall, event: "trigger", property: 196624, range: ["monsterZone"], triggerEvent: "customEvent" },
    ]);

    const returnAction = getLuaRestoreLegalActions(restoredReturn, 0).find((action) =>
      action.type === "activateEffect" && action.uid === returnFirewall.uid
    );
    expect(returnAction, JSON.stringify(getLuaRestoreLegalActions(restoredReturn, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredReturn, returnAction!);
    resolveRestoredChain(restoredReturn);

    expect(restoredReturn.session.state.cards.find((card) => card.uid === returnTarget.uid)).toMatchObject({
      location: "hand",
      controller: 1,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: returnFirewall.uid,
      reasonEffectId: 2,
    });
    expect(currentAttack(returnFirewall, restoredReturn.session.state)).toBe(4000);
    expect(restoredReturn.session.state.effects.filter((effect) => effect.sourceUid === returnFirewall.uid && effect.code === effectUpdateAttack).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, reset: { flags: 33492992 }, sourceUid: returnFirewall.uid, value: 500 },
    ]);
    expect(restoredReturn.session.state.eventHistory.filter((event) => ["becameTarget", "sentToHand"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      relatedEffectId: event.relatedEffectId,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
    }))).toEqual([
      { eventName: "becameTarget", eventCode: 1028, eventCardUid: returnTarget.uid, eventReason: 0, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, relatedEffectId: 2, previous: "deck", current: "monsterZone" },
      { eventName: "sentToHand", eventCode: 1012, eventCardUid: returnTarget.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: returnFirewall.uid, eventReasonEffectId: 2, relatedEffectId: undefined, previous: "monsterZone", current: "hand" },
    ]);

    const restoredLinked = createRestoredFirewallField({ reader, source, workspace });
    expectCleanRestore(restoredLinked);
    expectRestoredLegalActions(restoredLinked, 0);
    const linkedFirewall = requireCard(restoredLinked.session, firewallCode);
    const linkedSent = requireCard(restoredLinked.session, linkedSentCode);
    const graveCyberse = requireCard(restoredLinked.session, graveCyberseCode);
    sendDuelCardToGraveyard(restoredLinked.session.state, linkedSent.uid, 0, duelReason.effect, 0, {
      eventReasonCardUid: linkedFirewall.uid,
      eventReasonEffectId: 900,
    });
    expect(restoredLinked.session.state.pendingTriggers.map((trigger) => ({
      effectId: trigger.effectId,
      eventCardUid: trigger.eventCardUid,
      eventCode: trigger.eventCode,
      eventName: trigger.eventName,
      eventPlayer: trigger.eventPlayer,
      eventReason: trigger.eventReason,
      eventReasonCardUid: trigger.eventReasonCardUid,
      eventReasonEffectId: trigger.eventReasonEffectId,
      player: trigger.player,
      sourceUid: trigger.sourceUid,
      triggerBucket: trigger.triggerBucket,
    }))).toEqual([
      {
        effectId: "lua-5-290072666",
        eventCardUid: linkedFirewall.uid,
        eventCode: eventCustomFirewall,
        eventName: "customEvent",
        eventPlayer: 0,
        eventReason: 0,
        eventReasonCardUid: linkedFirewall.uid,
        eventReasonEffectId: 4,
        player: 0,
        sourceUid: linkedFirewall.uid,
        triggerBucket: "turnOptional",
      },
    ]);
    expect(restoredLinked.session.state.eventHistory.filter((event) => ["sentToGraveyard", "customEvent"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventPlayer: event.eventPlayer,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
      previousSequence: event.eventPreviousState?.sequence,
      currentSequence: event.eventCurrentState?.sequence,
    }))).toEqual([
      { eventName: "sentToGraveyard", eventCode: eventSentToGraveyard, eventCardUid: linkedSent.uid, eventPlayer: undefined, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: linkedFirewall.uid, eventReasonEffectId: 900, previous: "monsterZone", current: "graveyard", previousSequence: 1, currentSequence: 2 },
      { eventName: "customEvent", eventCode: eventCustomFirewall, eventCardUid: linkedFirewall.uid, eventPlayer: 0, eventReason: 0, eventReasonPlayer: 0, eventReasonCardUid: linkedFirewall.uid, eventReasonEffectId: 4, previous: "extraDeck", current: "monsterZone", previousSequence: 0, currentSequence: 0 },
    ]);

    const restoredRevive = restoreDuelWithLuaScripts(serializeDuel(restoredLinked.session), source, reader);
    expectCleanRestore(restoredRevive);
    expectRestoredLegalActions(restoredRevive, 0);
    const reviveTrigger = getLuaRestoreLegalActions(restoredRevive, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === linkedFirewall.uid
    );
    expect(reviveTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredRevive, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredRevive, reviveTrigger!);
    expect(restoredRevive.session.state.chain[0]?.targetUids).toEqual([graveCyberse.uid]);
    expect(restoredRevive.session.state.chain.flatMap((link) => link.operationInfos ?? [])).toEqual([
      { category: 512, targetUids: [graveCyberse.uid], count: 1, player: 0, parameter: 0 },
    ]);
    resolveRestoredChain(restoredRevive);

    expect(restoredRevive.session.state.cards.find((card) => card.uid === graveCyberse.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: linkedFirewall.uid,
      reasonEffectId: 5,
    });
    expect(restoredRevive.session.state.eventHistory.filter((event) => ["becameTarget", "specialSummoned"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      relatedEffectId: event.relatedEffectId,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
    }))).toEqual([
      { eventName: "becameTarget", eventCode: 1028, eventCardUid: graveCyberse.uid, eventReason: 0, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, relatedEffectId: 5, previous: "deck", current: "graveyard" },
      { eventName: "specialSummoned", eventCode: 1102, eventCardUid: graveCyberse.uid, eventReason: duelReason.summon | duelReason.specialSummon, eventReasonPlayer: 0, eventReasonCardUid: linkedFirewall.uid, eventReasonEffectId: 5, relatedEffectId: undefined, previous: "graveyard", current: "monsterZone" },
    ]);
    expect(restoredRevive.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function createRestoredFirewallField({
  reader,
  source,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  source: ReturnType<typeof createUpstreamNodeWorkspace>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 21637210, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [statTypeCode, linkedSentCode, graveCyberseCode], extra: [firewallCode] }, 1: { main: [returnTargetCode] } });
  startDuel(session);
  moveFaceUpAttack(session, requireCard(session, firewallCode), 0, 0);
  moveDuelCard(session.state, requireCard(session, statTypeCode).uid, "graveyard", 0).faceUp = true;
  moveFaceUpAttack(session, requireCard(session, linkedSentCode), 0, 1);
  moveDuelCard(session.state, requireCard(session, graveCyberseCode).uid, "graveyard", 0).faceUp = true;
  moveFaceUpAttack(session, requireCard(session, returnTargetCode), 1, 0);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;

  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(firewallCode), source).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Link.AddProcedure(c,aux.FilterBoolFunctionEx(Card.IsType,TYPE_EFFECT),3)");
  expect(script).toContain("e1:SetCategory(CATEGORY_TOHAND+CATEGORY_ATKCHANGE)");
  expect(script).toContain("e1:SetType(EFFECT_TYPE_QUICK_O)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET+EFFECT_FLAG_DAMAGE_STEP)");
  expect(script).toContain("e1:SetCode(EVENT_FREE_CHAIN)");
  expect(script).toContain("aux.StatChangeDamageStepCondition");
  expect(script).toContain("Duel.SelectTarget(tp,Card.IsAbleToHand,tp,0,LOCATION_ONFIELD|LOCATION_GRAVE,1,ct,nil)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_TOHAND,g,#g,0,0)");
  expect(script).toContain("Duel.GetOperatedGroup():FilterCount(Card.IsLocation,nil,LOCATION_HAND)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(ct*500)");
  expect(script).toContain("e2:SetCode(EVENT_BATTLE_DESTROYED)");
  expect(script).toContain("e3:SetCode(EVENT_TO_GRAVE)");
  expect(script).toContain("return not c:IsReason(REASON_BATTLE) and s.cfilter(c,tp,zone)");
  expect(script).toContain("Duel.RaiseSingleEvent(e:GetHandler(),EVENT_CUSTOM+id,e,0,tp,0,0)");
  expect(script).toContain("e4:SetCode(EVENT_CUSTOM+id)");
  expect(script).toContain("Duel.SelectTarget(tp,s.spfilter,tp,LOCATION_GRAVE,0,1,1,nil,e,tp)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,g,1,tp,0)");
  expect(script).toContain("Duel.SpecialSummon(tc,0,tp,tp,false,false,POS_FACEUP)");
}

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const firewall = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === firewallCode);
  expect(firewall).toBeDefined();
  return [
    { ...firewall!, kind: "extra", typeFlags: typeMonster | typeEffect | typeLink, race: raceCyberse, attribute: attributeDark, attack: 3500, defense: 0, linkMarkers: 0x20, linkMaterialMin: 3, linkMaterialType: typeEffect },
    { code: statTypeCode, name: "Firewall Singularity Fusion Counter", kind: "extra", typeFlags: typeMonster | typeEffect | typeFusion, race: raceWarrior, attribute: attributeLight, level: 4, attack: 1800, defense: 1000 },
    { code: returnTargetCode, name: "Firewall Singularity Return Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeLight, level: 4, attack: 1600, defense: 1000 },
    { code: linkedSentCode, name: "Firewall Singularity Linked Monster", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceCyberse, attribute: attributeDark, level: 4, attack: 1200, defense: 1000 },
    { code: graveCyberseCode, name: "Firewall Singularity Grave Cyberse", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceCyberse, attribute: attributeDark, level: 4, attack: 1400, defense: 1000 },
  ];
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.sequence = sequence;
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  return moved;
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

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = response.state.waitingFor as PlayerId | undefined;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}

function resolveRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(20);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}
