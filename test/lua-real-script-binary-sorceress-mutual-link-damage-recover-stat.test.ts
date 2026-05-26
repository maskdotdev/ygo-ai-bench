import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const binaryCode = "79016563";
const leftLinkCode = "790165630";
const rightLinkCode = "790165631";
const defenderCode = "790165632";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasBinaryScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${binaryCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeLink = 0x4000000;
const raceCyberse = 0x1000000;
const raceWarrior = 0x1;
const attributeLight = 0x1;
const attributeEarth = 0x10;
const effectUpdateAttack = 100;
const effectSetAttackFinal = 102;
const eventBattleDamage = 1143;
const eventRecover = 1112;

describe.skipIf(!hasUpstreamScripts || !hasBinaryScript)("Lua real script Binary Sorceress mutual link damage recover stat", () => {
  it("restores mutual-linked battle damage recovery and two-target ATK redistribution", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${binaryCode}.lua`);
    expectBinaryScriptShape(script);
    const reader = createCardReader(cards());
    const restoredOpen = createRestoredOpen({ reader, workspace });
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const binary = requireCard(restoredOpen.session, binaryCode);
    const leftLink = requireCard(restoredOpen.session, leftLinkCode);
    const rightLink = requireCard(restoredOpen.session, rightLinkCode);
    const defender = requireCard(restoredOpen.session, defenderCode);

    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === binary.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      event: effect.event,
      property: effect.property,
      range: effect.range,
      triggerEvent: effect.triggerEvent,
    }))).toEqual([
      { category: undefined, code: 31, event: "continuous", property: 263168, range: ["monsterZone"], triggerEvent: undefined },
      { category: 1048576, code: eventBattleDamage, event: "trigger", property: undefined, range: ["monsterZone"], triggerEvent: "battleDamageDealt" },
      { category: 2097152, code: 1002, event: "quick", property: 16384, range: ["monsterZone"], triggerEvent: undefined },
    ]);

    const restoredQuick = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredQuick);
    expectRestoredLegalActions(restoredQuick, 0);
    const redistribute = getLuaRestoreLegalActions(restoredQuick, 0).find((action) => action.type === "activateEffect" && action.uid === binary.uid);
    expect(redistribute, JSON.stringify(getLuaRestoreLegalActions(restoredQuick, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredQuick, redistribute!);
    resolveRestoredChain(restoredQuick);

    expect(currentAttack(restoredQuick.session.state.cards.find((card) => card.uid === leftLink.uid), restoredQuick.session.state)).toBe(1000);
    expect(currentAttack(restoredQuick.session.state.cards.find((card) => card.uid === binary.uid), restoredQuick.session.state)).toBe(2600);
    expect(currentAttack(restoredQuick.session.state.cards.find((card) => card.uid === rightLink.uid), restoredQuick.session.state)).toBe(1200);
    expect(restoredQuick.session.state.effects.filter((effect) => [effectSetAttackFinal, effectUpdateAttack].includes(effect.code ?? -1)).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectSetAttackFinal, reset: { flags: 1107169792 }, sourceUid: leftLink.uid, value: 1000 },
      { code: effectUpdateAttack, reset: { flags: 1107169792 }, sourceUid: binary.uid, value: 1000 },
    ]);
    expect(restoredQuick.session.state.eventHistory.filter((event) => event.eventName === "becameTarget").map((event) => ({
      eventCardUid: event.eventCardUid,
      relatedEffectId: event.relatedEffectId,
      eventChainDepth: event.eventChainDepth,
      eventChainLinkId: event.eventChainLinkId,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
    }))).toEqual([
      { eventCardUid: leftLink.uid, relatedEffectId: 3, eventChainDepth: 1, eventChainLinkId: "chain-2", previous: "extraDeck", current: "monsterZone" },
      { eventCardUid: binary.uid, relatedEffectId: 3, eventChainDepth: 1, eventChainLinkId: "chain-2", previous: "extraDeck", current: "monsterZone" },
    ]);

    const restoredBattle = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredBattle);
    restoredBattle.session.state.phase = "battle";
    restoredBattle.session.state.waitingFor = 0;
    expectRestoredLegalActions(restoredBattle, 0);
    const attack = getLuaRestoreLegalActions(restoredBattle, 0).find((action) =>
      action.type === "declareAttack" && action.attackerUid === leftLink.uid && action.targetUid === defender.uid
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredBattle, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredBattle, attack!);
    passBattleUntilTrigger(restoredBattle);
    expect(restoredBattle.session.state.players[1].lifePoints).toBe(7000);
    expect(restoredBattle.session.state.pendingTriggers).toEqual([
      {
        id: "trigger-5-1",
        effectId: "lua-2-1143",
        eventCardUid: leftLink.uid,
        eventCode: eventBattleDamage,
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventName: "battleDamageDealt",
        eventPlayer: 1,
        eventPreviousState: { controller: 0, faceUp: false, location: "extraDeck", position: "faceDown", sequence: 1 },
        eventReason: duelReason.battle,
        eventReasonCardUid: leftLink.uid,
        eventReasonPlayer: 0,
        eventTriggerTiming: "when",
        eventValue: 1000,
        player: 0,
        sourceUid: binary.uid,
        triggerBucket: "turnOptional",
      },
    ]);

    const restoredRecover = restoreDuelWithLuaScripts(serializeDuel(restoredBattle.session), workspace, reader);
    expectCleanRestore(restoredRecover);
    expectRestoredLegalActions(restoredRecover, 0);
    const recover = getLuaRestoreLegalActions(restoredRecover, 0).find((action) => action.type === "activateTrigger" && action.uid === binary.uid);
    expect(recover, JSON.stringify(getLuaRestoreLegalActions(restoredRecover, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredRecover, recover!);
    resolveRestoredChain(restoredRecover);

    expect(restoredRecover.session.state.players[0].lifePoints).toBe(9000);
    expect(restoredRecover.session.state.eventHistory.filter((event) => ["battleDamageDealt", "recoveredLifePoints"].includes(event.eventName)).map((event) => ({
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
      { eventName: "battleDamageDealt", eventCode: eventBattleDamage, eventCardUid: leftLink.uid, eventPlayer: 1, eventValue: 1000, eventReason: duelReason.battle, eventReasonPlayer: 0, eventReasonCardUid: leftLink.uid, eventReasonEffectId: undefined, previous: "extraDeck", current: "monsterZone" },
      { eventName: "recoveredLifePoints", eventCode: eventRecover, eventCardUid: undefined, eventPlayer: 0, eventValue: 1000, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: binary.uid, eventReasonEffectId: 2, previous: undefined, current: undefined },
    ]);
    expect(restoredRecover.session.state.battleDamage).toEqual({ 0: 0, 1: 1000 });
  });
});

function createRestoredOpen({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 79016563, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [], extra: [binaryCode, leftLinkCode, rightLinkCode] }, 1: { main: [defenderCode] } });
  startDuel(session);
  const binary = requireCard(session, binaryCode);
  const leftLink = requireCard(session, leftLinkCode);
  const rightLink = requireCard(session, rightLinkCode);
  const defender = requireCard(session, defenderCode);
  moveFaceUpLink(session, leftLink, 0, 0);
  moveFaceUpLink(session, binary, 0, 1);
  moveFaceUpLink(session, rightLink, 0, 2);
  moveFaceUpAttack(session, defender, 1, 0);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;

  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(binaryCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function expectBinaryScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Link.AddProcedure(c,s.matfilter,2,2)");
  expect(script).toContain("return not c:IsType(TYPE_TOKEN,lc,sumtype,tp)");
  expect(script).toContain("e1:SetCategory(CATEGORY_RECOVER)");
  expect(script).toContain("e1:SetCode(EVENT_BATTLE_DAMAGE)");
  expect(script).toContain("local lg=e:GetHandler():GetMutualLinkedGroup()");
  expect(script).toContain("return ep~=tp and lg:IsContains(tc) and tc:GetBattleTarget()~=nil");
  expect(script).toContain("Duel.SetTargetPlayer(tp)");
  expect(script).toContain("Duel.SetTargetParam(ev)");
  expect(script).toContain("Duel.Recover(p,d,REASON_EFFECT)");
  expect(script).toContain("e2:SetCategory(CATEGORY_ATKCHANGE)");
  expect(script).toContain("e2:SetProperty(EFFECT_FLAG_DAMAGE_STEP)");
  expect(script).toContain("return aux.StatChangeDamageStepCondition() and e:GetHandler():GetMutualLinkedGroupCount()>=2");
  expect(script).toContain("Duel.SelectTarget(tp,Card.IsFaceup,tp,LOCATION_MZONE,0,1,1,nil)");
  expect(script).toContain("e:SetLabelObject(g1:GetFirst())");
  expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK_FINAL)");
  expect(script).toContain("e1:SetValue(atk/2)");
  expect(script).toContain("e2:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e2:SetValue(atk/2)");
}

function cards(): DuelCardData[] {
  return [
    { code: binaryCode, name: "Binary Sorceress", kind: "extra", typeFlags: typeMonster | typeEffect | typeLink, race: raceCyberse, attribute: attributeEarth, level: 2, attack: 1600, defense: 0, linkMarkers: 0x28, linkMaterialMin: 2, linkMaterialMax: 2 },
    { code: leftLinkCode, name: "Binary Sorceress Left Link", kind: "extra", typeFlags: typeMonster | typeEffect | typeLink, race: raceCyberse, attribute: attributeLight, level: 1, attack: 2000, defense: 0, linkMarkers: 0x20 },
    { code: rightLinkCode, name: "Binary Sorceress Right Link", kind: "extra", typeFlags: typeMonster | typeEffect | typeLink, race: raceCyberse, attribute: attributeLight, level: 1, attack: 1200, defense: 0, linkMarkers: 0x8 },
    { code: defenderCode, name: "Binary Sorceress Defender", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1000, defense: 1000 },
  ];
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpLink(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveFaceUpAttack(session, card, player, sequence);
  moved.summonType = "link";
  moved.summonTypeCode = 0x4c000000;
  return moved;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.sequence = sequence;
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  return moved;
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

function passBattleUntilTrigger(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.pendingBattle && restored.session.state.pendingTriggers.length === 0) {
    expect(++guard).toBeLessThan(20);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const passType = restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}
