import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { banishDuelCard, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const dormouseCode = "32061192";
const deckMalissCode = "320611920";
const linkedMalissCode = "320611921";
const openMonsterCode = "320611922";
const linkProbeCode = "320611923";
const nonLinkProbeCode = "320611924";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasDormouseScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${dormouseCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeFusion = 0x40;
const typeLink = 0x4000000;
const raceCyberse = 0x1000000;
const attributeDark = 0x20;
const setMaliss = 0x1b9;
const effectIndestructableEffect = 41;
const effectUpdateAttack = 100;
const effectCannotSpecialSummon = 22;

describe.skipIf(!hasUpstreamScripts || !hasDormouseScript)("Lua real script Maliss Dormouse banish summon lock stat", () => {
  it("restores linked Maliss protection, Deck banish ATK gain, and banished LP summon lock", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${dormouseCode}.lua`));
    const reader = createCardReader(cards());

    const restoredProtection = createRestoredDormouseField({ reader, workspace });
    expectCleanRestore(restoredProtection);
    expectRestoredLegalActions(restoredProtection, 0);
    const protectedLink = requireCard(restoredProtection.session, linkedMalissCode);
    const openMonster = requireCard(restoredProtection.session, openMonsterCode);
    const protectionProbe = restoredProtection.host.loadScript(
      `
      local protected_link=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${linkedMalissCode}),0,LOCATION_MZONE,0,nil)
      local open_monster=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${openMonsterCode}),0,LOCATION_MZONE,0,nil)
      Debug.Message("dormouse linked destroy " .. Duel.Destroy(protected_link,REASON_EFFECT) .. "/" .. Duel.Destroy(open_monster,REASON_EFFECT))
      `,
      "maliss-dormouse-linked-protection-probe.lua",
    );
    expect(protectionProbe.ok, protectionProbe.error).toBe(true);
    expect(restoredProtection.host.messages).toContain("dormouse linked destroy 0/1");
    expect(restoredProtection.session.state.cards.find((card) => card.uid === protectedLink.uid)).toMatchObject({ location: "monsterZone", controller: 0 });
    expect(restoredProtection.session.state.cards.find((card) => card.uid === openMonster.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.effect | duelReason.destroy,
    });
    expect(restoredProtection.session.state.effects.filter((effect) => effect.sourceUid === requireCard(restoredProtection.session, dormouseCode).uid && effect.code === effectIndestructableEffect).map((effect) => ({
      code: effect.code,
      sourceUid: effect.sourceUid,
      targetRange: effect.targetRange,
      value: effect.value,
    }))).toEqual([
      { code: effectIndestructableEffect, sourceUid: requireCard(restoredProtection.session, dormouseCode).uid, targetRange: [4, 4], value: 1 },
    ]);

    const restoredIgnition = createRestoredDormouseField({ reader, workspace });
    expectCleanRestore(restoredIgnition);
    expectRestoredLegalActions(restoredIgnition, 0);
    const ignitionDormouse = requireCard(restoredIgnition.session, dormouseCode);
    const ignitionDeckTarget = requireCard(restoredIgnition.session, deckMalissCode);
    const ignitionLink = requireCard(restoredIgnition.session, linkedMalissCode);
    const ignition = getLuaRestoreLegalActions(restoredIgnition, 0).find((action) => action.type === "activateEffect" && action.uid === ignitionDormouse.uid);
    expect(ignition, JSON.stringify(getLuaRestoreLegalActions(restoredIgnition, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredIgnition, ignition!);
    resolveRestoredChain(restoredIgnition);
    expect(restoredIgnition.session.state.cards.find((card) => card.uid === ignitionDeckTarget.uid)).toMatchObject({
      location: "banished",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: ignitionDormouse.uid,
      reasonEffectId: 2,
    });
    expect(currentAttack(restoredIgnition.session.state.cards.find((card) => card.uid === ignitionDormouse.uid), restoredIgnition.session.state)).toBe(1500);
    expect(currentAttack(restoredIgnition.session.state.cards.find((card) => card.uid === ignitionLink.uid), restoredIgnition.session.state)).toBe(2600);
    expect(restoredIgnition.session.state.effects.filter((effect) => effect.sourceUid === ignitionDormouse.uid && effect.code === effectUpdateAttack).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      targetRange: effect.targetRange,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, reset: { flags: 1073742336 }, sourceUid: ignitionDormouse.uid, targetRange: [4, 0], value: 600 },
    ]);
    expect(restoredIgnition.session.state.eventHistory.filter((event) => event.eventName === "banished" && event.eventCardUid === ignitionDeckTarget.uid)).toEqual([
      {
        eventName: "banished",
        eventCode: 1011,
        eventCardUid: ignitionDeckTarget.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: ignitionDormouse.uid,
        eventReasonEffectId: 2,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 3 },
        eventCurrentState: { controller: 0, faceUp: true, location: "banished", position: "faceDown", sequence: 0 },
      },
    ]);

    const restoredBanish = createRestoredDormouseField({ reader, workspace });
    expectCleanRestore(restoredBanish);
    const triggerDormouse = requireCard(restoredBanish.session, dormouseCode);
    banishDuelCard(restoredBanish.session.state, triggerDormouse.uid, 0, duelReason.effect, 0);
    expect(restoredBanish.session.state.pendingTriggers.map((trigger) => ({
      effectId: trigger.effectId,
      eventCardUid: trigger.eventCardUid,
      eventCode: trigger.eventCode,
      eventName: trigger.eventName,
      eventReason: trigger.eventReason,
      player: trigger.player,
      sourceUid: trigger.sourceUid,
      triggerBucket: trigger.triggerBucket,
    }))).toEqual([
      { effectId: "lua-3-1011", eventCardUid: triggerDormouse.uid, eventCode: 1011, eventName: "banished", eventReason: duelReason.effect, player: 0, sourceUid: triggerDormouse.uid, triggerBucket: "turnOptional" },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredBanish.session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const summon = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === triggerDormouse.uid && action.effectId === "lua-3-1011");
    expect(summon, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, summon!);
    resolveRestoredChain(restoredTrigger);
    expect(restoredTrigger.session.state.players[0].lifePoints).toBe(7700);
    expect(restoredTrigger.session.state.cards.find((card) => card.uid === triggerDormouse.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: triggerDormouse.uid,
      reasonEffectId: 3,
    });
    expect(restoredTrigger.session.state.effects.filter((effect) => effect.sourceUid === triggerDormouse.uid && effect.code === effectCannotSpecialSummon).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      targetRange: effect.targetRange,
    }))).toEqual([
      { code: effectCannotSpecialSummon, reset: { flags: 1073742336 }, sourceUid: triggerDormouse.uid, targetRange: [1, 0] },
    ]);
    const lockProbe = restoredTrigger.host.loadScript(
      `
      local link_probe=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${linkProbeCode}),0,LOCATION_EXTRA,0,nil)
      local non_link_probe=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${nonLinkProbeCode}),0,LOCATION_EXTRA,0,nil)
      Debug.Message("dormouse extra can special " .. tostring(Duel.IsPlayerCanSpecialSummon(0,0,POS_FACEUP_ATTACK,0,link_probe)) .. "/" .. tostring(Duel.IsPlayerCanSpecialSummon(0,0,POS_FACEUP_ATTACK,0,non_link_probe)))
      `,
      "maliss-dormouse-extra-lock-probe.lua",
    );
    expect(lockProbe.ok, lockProbe.error).toBe(true);
    expect(restoredTrigger.host.messages).toContain("dormouse extra can special true/false");
    expect(restoredTrigger.session.state.eventHistory.filter((event) => ["banished", "lifePointCostPaid", "specialSummoned"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventPlayer: event.eventPlayer,
      eventValue: event.eventValue,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
    }))).toEqual([
      { eventName: "banished", eventCode: 1011, eventCardUid: triggerDormouse.uid, eventPlayer: undefined, eventValue: undefined, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, previous: "monsterZone", current: "banished" },
      { eventName: "lifePointCostPaid", eventCode: 1201, eventCardUid: undefined, eventPlayer: 0, eventValue: 300, eventReason: duelReason.cost, eventReasonPlayer: 0, eventReasonCardUid: triggerDormouse.uid, eventReasonEffectId: 3, previous: undefined, current: undefined },
      { eventName: "specialSummoned", eventCode: 1102, eventCardUid: triggerDormouse.uid, eventPlayer: undefined, eventValue: undefined, eventReason: duelReason.summon | duelReason.specialSummon, eventReasonPlayer: 0, eventReasonCardUid: triggerDormouse.uid, eventReasonEffectId: 3, previous: "banished", current: "monsterZone" },
    ]);
    expect(restoredTrigger.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function createRestoredDormouseField({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 32061192, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [dormouseCode, deckMalissCode, linkedMalissCode, openMonsterCode], extra: [linkProbeCode, nonLinkProbeCode] }, 1: { main: [] } });
  startDuel(session);
  moveFaceUpAttack(session, requireCard(session, linkedMalissCode), 0, 1);
  moveFaceUpAttack(session, requireCard(session, dormouseCode), 0, 2);
  moveFaceUpAttack(session, requireCard(session, openMonsterCode), 0, 3);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;

  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(dormouseCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("e1:SetCode(EFFECT_INDESTRUCTABLE_EFFECT)");
  expect(script).toContain("c:GetLinkedGroup():IsContains(e:GetHandler())");
  expect(script).toContain("e2:SetCategory(CATEGORY_REMOVE+CATEGORY_ATKCHANGE)");
  expect(script).toContain("Duel.SelectMatchingCard(tp,s.rmfilter,tp,LOCATION_DECK,0,1,1,nil)");
  expect(script).toContain("Duel.Remove(g,POS_FACEUP,REASON_EFFECT)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetTarget(aux.TargetBoolFunction(Card.IsSetCard,SET_MALISS))");
  expect(script).toContain("aux.RegisterClientHint(c,0,tp,1,0,aux.Stringid(id,2))");
  expect(script).toContain("e3:SetCode(EVENT_REMOVE)");
  expect(script).toContain("e3:SetCost(Cost.PayLP(300))");
  expect(script).toContain("Duel.SpecialSummon(c,0,tp,tp,false,false,POS_FACEUP)");
  expect(script).toContain("e1:SetCode(EFFECT_CANNOT_SPECIAL_SUMMON)");
  expect(script).toContain("return c:IsLocation(LOCATION_EXTRA) and not c:IsType(TYPE_LINK)");
  expect(script).toContain("aux.addTempLizardCheck(c,tp,function(e,c) return not c:IsOriginalType(TYPE_LINK) end)");
}

function cards(): DuelCardData[] {
  return [
    { code: dormouseCode, name: "Maliss <P> Dormouse", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceCyberse, attribute: attributeDark, level: 3, attack: 900, defense: 300, setcodes: [setMaliss] },
    { code: deckMalissCode, name: "Dormouse Deck Maliss", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceCyberse, attribute: attributeDark, level: 3, attack: 1000, defense: 1000, setcodes: [setMaliss] },
    { code: linkedMalissCode, name: "Dormouse Linked Maliss Link", kind: "extra", typeFlags: typeMonster | typeEffect | typeLink, race: raceCyberse, attribute: attributeDark, level: 2, attack: 2000, defense: 0, setcodes: [setMaliss], linkMarkers: 0x20 },
    { code: openMonsterCode, name: "Dormouse Open Monster", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceCyberse, attribute: attributeDark, level: 4, attack: 1200, defense: 1000 },
    { code: linkProbeCode, name: "Dormouse Link Probe", kind: "extra", typeFlags: typeMonster | typeEffect | typeLink, race: raceCyberse, attribute: attributeDark, level: 2, attack: 1500, defense: 0, linkMarkers: 0x20 },
    { code: nonLinkProbeCode, name: "Dormouse Non-Link Probe", kind: "extra", typeFlags: typeMonster | typeEffect | typeFusion, race: raceCyberse, attribute: attributeDark, level: 4, attack: 1800, defense: 1000 },
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
  const waitingFor = response.state.waitingFor;
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
    applyRestoredActionAndAssert(restored, pass!);
  }
}
