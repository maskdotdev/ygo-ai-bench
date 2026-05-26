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
const niNiCode = "54862960";
const equipCode = "548629600";
const targetCode = "548629601";
const facedownDecoyCode = "548629602";
const responderCode = "548629603";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasNiNiScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${niNiCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeSpell = 0x2;
const typeEquip = 0x40000;
const raceSpellcaster = 0x2;
const raceWarrior = 0x1;
const attributeFire = 0x4;
const attributeEarth = 0x1;
const effectIndestructableBattle = 42;
const effectAvoidBattleDamage = 201;
const effectReflectBattleDamage = 202;
const eventFreeChain = 1002;
const categoryControl = 0x2000;
const effectFlagCardTarget = 0x10;

describe.skipIf(!hasUpstreamScripts || !hasNiNiScript)("Lua real script Ni-Ni Mikanko equipped control", () => {
  it("restores equipped battle modifiers and opponent-turn quick control", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${niNiCode}.lua`));
    const reader = createCardReader(cards());
    const session = createDuel({ seed: 54862960, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [niNiCode, equipCode] }, 1: { main: [targetCode, facedownDecoyCode, responderCode] } });
    startDuel(session);

    const niNi = requireCard(session, niNiCode);
    const equip = requireCard(session, equipCode);
    const target = requireCard(session, targetCode);
    const facedownDecoy = requireCard(session, facedownDecoyCode);
    const responder = requireCard(session, responderCode);
    moveFaceUpAttack(session, niNi, 0, 0);
    moveFaceUpEquip(session, equip, 0, 0, niNi.uid);
    moveFaceUpAttack(session, target, 1, 0);
    moveFaceDownDefense(session, facedownDecoy, 1, 1);
    moveDuelCard(session.state, responder.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 1;
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(niNiCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === niNi.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      countLimit: effect.countLimit,
      event: effect.event,
      property: effect.property,
      range: effect.range,
      triggerEvent: effect.triggerEvent,
      value: effect.value,
    }))).toEqual([
      { category: undefined, code: effectAvoidBattleDamage, countLimit: undefined, event: "continuous", property: undefined, range: ["monsterZone"], triggerEvent: undefined, value: 1 },
      { category: undefined, code: effectIndestructableBattle, countLimit: undefined, event: "continuous", property: undefined, range: ["monsterZone"], triggerEvent: undefined, value: 1 },
      { category: undefined, code: effectReflectBattleDamage, countLimit: undefined, event: "continuous", property: undefined, range: ["monsterZone"], triggerEvent: undefined, value: 1 },
      { category: categoryControl, code: eventFreeChain, countLimit: 1, event: "quick", property: effectFlagCardTarget, range: ["monsterZone"], triggerEvent: undefined, value: undefined },
    ]);

    const quick = getLuaRestoreLegalActions(restoredOpen, 0).find((action) =>
      action.type === "activateEffect" && action.uid === niNi.uid && action.effectId === `lua-4-${eventFreeChain}`
    );
    expect(quick, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, quick!);

    expect(restoredOpen.session.state.chain.map((link) => ({
      operationInfos: link.operationInfos,
      player: link.player,
      sourceUid: link.sourceUid,
      targetUids: link.targetUids,
    }))).toEqual([
      {
        operationInfos: [{ category: categoryControl, targetUids: [target.uid], count: 1, player: 0, parameter: 0 }],
        player: 0,
        sourceUid: niNi.uid,
        targetUids: [target.uid],
      },
    ]);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, 1);
    expect(getLuaRestoreLegalActions(restoredChain, 1).some((action) =>
      action.type === "activateEffect" && action.uid === responder.uid
    )).toBe(true);
    resolveRestoredChain(restoredChain);

    expect(restoredChain.host.messages).not.toContain("ni-ni responder resolved");
    expect(findCard(restoredChain.session, target.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      previousController: 1,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: niNi.uid,
      reasonEffectId: 4,
    });
    expect(findCard(restoredChain.session, facedownDecoy.uid)).toMatchObject({ location: "monsterZone", controller: 1, faceUp: false });
    expect(findCard(restoredChain.session, equip.uid)).toMatchObject({ location: "spellTrapZone", controller: 0, equippedToUid: niNi.uid });
    expect(restoredChain.session.state.eventHistory.filter((event) => ["becameTarget", "controlChanged"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      relatedEffectId: event.relatedEffectId,
      previousLocation: event.eventPreviousState?.location,
      previousController: event.eventPreviousState?.controller,
      currentLocation: event.eventCurrentState?.location,
      currentController: event.eventCurrentState?.controller,
    }))).toEqual([
      { eventName: "becameTarget", eventCode: 1028, eventCardUid: target.uid, eventReason: 0, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, relatedEffectId: 4, previousLocation: "deck", previousController: 1, currentLocation: "monsterZone", currentController: 1 },
      { eventName: "controlChanged", eventCode: 1120, eventCardUid: target.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: niNi.uid, eventReasonEffectId: 4, relatedEffectId: undefined, previousLocation: "monsterZone", previousController: 1, currentLocation: "monsterZone", currentController: 0 },
    ]);

    const restoredControl = restoreDuelWithLuaScripts(serializeDuel(restoredChain.session), source, reader);
    expectCleanRestore(restoredControl);
    expectRestoredLegalActions(restoredControl, 1);
    expect(findCard(restoredControl.session, target.uid)).toMatchObject({ controller: 0, previousController: 1 });
  });
});

function cards(): DuelCardData[] {
  return [
    { code: niNiCode, name: "Ni-Ni the Mirror Mikanko", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceSpellcaster, attribute: attributeFire, level: 3, attack: 0, defense: 0 },
    { code: equipCode, name: "Ni-Ni Equip Fixture", kind: "spell", typeFlags: typeSpell | typeEquip },
    { code: targetCode, name: "Ni-Ni Control Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1700, defense: 1200 },
    { code: facedownDecoyCode, name: "Ni-Ni Facedown Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1600, defense: 1000 },
    { code: responderCode, name: "Ni-Ni Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1000, defense: 1000 },
  ];
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Ni-Ni the Mirror Mikanko");
  expect(script).toContain("e1:SetCode(EFFECT_AVOID_BATTLE_DAMAGE)");
  expect(script).toContain("e1:SetCondition(aux.NOT(s.eqcon))");
  expect(script).toContain("e2:SetCode(EFFECT_INDESTRUCTABLE_BATTLE)");
  expect(script).toContain("e2:SetCondition(s.eqcon)");
  expect(script).toContain("e3:SetCode(EFFECT_REFLECT_BATTLE_DAMAGE)");
  expect(script).toContain("e4:SetCategory(CATEGORY_CONTROL)");
  expect(script).toContain("e4:SetType(EFFECT_TYPE_QUICK_O)");
  expect(script).toContain("e4:SetProperty(EFFECT_FLAG_CARD_TARGET)");
  expect(script).toContain("e4:SetCode(EVENT_FREE_CHAIN)");
  expect(script).toContain("e4:SetCondition(function(e,tp) return Duel.IsTurnPlayer(1-tp) and s.eqcon(e) end)");
  expect(script).toContain("Duel.SelectTarget(tp,aux.FaceupFilter(Card.IsControlerCanBeChanged),tp,0,LOCATION_MZONE,1,1,nil)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_CONTROL,g,1,0,0)");
  expect(script).toContain("Duel.GetFirstTarget()");
  expect(script).toContain("Duel.GetControl(tc,tp,PHASE_END,1)");
}

function chainResponderScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_QUICK_O)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetRange(LOCATION_HAND)
      e:SetCondition(function(e,tp) return Duel.GetCurrentChain()>0 end)
      e:SetOperation(function(e,tp) Debug.Message("ni-ni responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function findCard(session: DuelSession, uid: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.uid === uid);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, controller: PlayerId, sequence: number): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", controller);
  moved.sequence = sequence;
  moved.faceUp = true;
  moved.position = "faceUpAttack";
}

function moveFaceDownDefense(session: DuelSession, card: DuelCardInstance, controller: PlayerId, sequence: number): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", controller);
  moved.sequence = sequence;
  moved.faceUp = false;
  moved.position = "faceDownDefense";
}

function moveFaceUpEquip(session: DuelSession, card: DuelCardInstance, controller: PlayerId, sequence: number, equippedToUid: string): void {
  const moved = moveDuelCard(session.state, card.uid, "spellTrapZone", controller);
  moved.sequence = sequence;
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  moved.equippedToUid = equippedToUid;
  moved.cardTargetUids = [equippedToUid];
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
