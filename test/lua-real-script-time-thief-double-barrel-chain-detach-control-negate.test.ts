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
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const doubleBarrelCode = "91135480";
const materialMonsterCode = "911354801";
const materialSpellCode = "911354802";
const materialTrapCode = "911354803";
const opponentStarterCode = "911354804";
const opponentControlCode = "911354805";
const negatableCode = "911354806";
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeTrap = 0x4;
const typeXyz = 0x800000;
const typeEffect = 0x20;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Time Thief Double Barrel chain detach control", () => {
  it("restores EVENT_CHAINING Spell overlay detach into control steal and attack/trigger locks", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${doubleBarrelCode}.lua`);
    expect(script).toContain("e1:SetCode(EVENT_CHAINING)");
    expect(script).toContain("aux.SelectUnselectGroup(g:Filter(Card.IsType,nil,ty),e,tp,1,3,s.rescon,1,tp,HINTMSG_XMATERIAL)");
    expect(script).toContain("card_type=card_type|tc:GetMainCardType()");
    expect(script).toContain("Duel.SendtoGrave(sg,REASON_EFFECT)");
    expect(script).toContain("Duel.RaiseSingleEvent(c,EVENT_DETACH_MATERIAL,e,0,0,0,0)");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("Duel.GetControl(tc,tp,PHASE_END,1)");
    expect(script).toContain("e1:SetCode(EFFECT_CANNOT_ATTACK)");
    expect(script).toContain("e2:SetCode(EFFECT_CANNOT_TRIGGER)");
    expect(script).toContain("Duel.SelectMatchingCard(tp,Card.IsNegatableMonster,tp,LOCATION_MZONE,LOCATION_MZONE,1,1,nil)");
    expect(script).toContain("e1:SetCode(EFFECT_DISABLE)");
    expect(script).toContain("e2:SetCode(EFFECT_DISABLE_EFFECT)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === doubleBarrelCode),
      { code: materialMonsterCode, name: "Double Barrel Monster Material", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000 },
      { code: materialSpellCode, name: "Double Barrel Spell Material", kind: "spell", typeFlags: typeSpell, attack: 0, defense: 0 },
      { code: materialTrapCode, name: "Double Barrel Trap Material", kind: "trap", typeFlags: typeTrap, attack: 0, defense: 0 },
      { code: opponentStarterCode, name: "Double Barrel Opponent Starter", kind: "spell", typeFlags: typeSpell, attack: 0, defense: 0 },
      { code: opponentControlCode, name: "Double Barrel Control Target", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1800, defense: 1000 },
      { code: negatableCode, name: "Double Barrel Negatable Target", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1600, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 91135480, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, {
      0: { main: [materialMonsterCode, materialSpellCode, materialTrapCode, negatableCode], extra: [doubleBarrelCode] },
      1: { main: [opponentStarterCode, opponentControlCode] },
    });
    startDuel(session);

    const doubleBarrel = requireCard(session, doubleBarrelCode);
    const materialMonster = requireCard(session, materialMonsterCode);
    const materialSpell = requireCard(session, materialSpellCode);
    const materialTrap = requireCard(session, materialTrapCode);
    const opponentStarter = requireCard(session, opponentStarterCode);
    const opponentControl = requireCard(session, opponentControlCode);
    const negatable = requireCard(session, negatableCode);
    moveFaceUpMonster(session, doubleBarrel.uid, 0);
    doubleBarrel.data.typeFlags = typeMonster | typeXyz;
    moveDuelCard(session.state, materialMonster.uid, "overlay", 0);
    moveDuelCard(session.state, materialSpell.uid, "overlay", 0);
    moveDuelCard(session.state, materialTrap.uid, "overlay", 0);
    doubleBarrel.overlayUids.push(materialSpell.uid, materialMonster.uid, materialTrap.uid);
    moveFaceUpMonster(session, negatable.uid, 0);
    moveDuelCard(session.state, opponentStarter.uid, "hand", 1);
    moveFaceUpMonster(session, opponentControl.uid, 1);
    session.state.turnPlayer = 1;
    session.state.phase = "main1";
    session.state.waitingFor = 1;

    const source = {
      readScript(name: string) {
        if (name === `official/c${opponentStarterCode}.lua` || name === `c${opponentStarterCode}.lua`) return starterScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(doubleBarrelCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(opponentStarterCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);
    expect(host.messages).not.toContain("unsupported");

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 1);
    const starter = getLuaRestoreLegalActions(restoredOpen, 1).find((action) => action.type === "activateEffect" && action.uid === opponentStarter.uid);
    expect(starter, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 1), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, starter!);

    const restoredResponse = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
    expectCleanRestore(restoredResponse);
    expectRestoredLegalActions(restoredResponse, 0);
    expect(restoredResponse.session.state.chain[0]?.operationInfos ?? []).toEqual([]);
    const response = getLuaRestoreLegalActions(restoredResponse, 0).find((action) => action.type === "activateEffect" && action.uid === doubleBarrel.uid);
    expect(response, JSON.stringify(getLuaRestoreLegalActions(restoredResponse, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredResponse, response!);
    resolveRestoredChain(restoredResponse);
    expect(restoredResponse.session.state.cards.find((card) => card.uid === doubleBarrel.uid)?.overlayUids).toEqual([materialMonster.uid, materialTrap.uid]);
    expect(restoredResponse.session.state.cards.find((card) => card.uid === materialSpell.uid)).toMatchObject({ location: "graveyard", reason: duelReason.effect });
    expect(restoredResponse.session.state.cards.find((card) => card.uid === materialMonster.uid)).toMatchObject({ location: "overlay", controller: 0 });
    expect(restoredResponse.session.state.cards.find((card) => card.uid === materialTrap.uid)).toMatchObject({ location: "overlay", controller: 0 });
    expect(restoredResponse.session.state.cards.find((card) => card.uid === opponentControl.uid)).toMatchObject({ location: "monsterZone", controller: 0 });
    expect(restoredResponse.session.state.cards.find((card) => card.uid === negatable.uid)).toMatchObject({ location: "monsterZone", controller: 0 });
    expect(restoredResponse.session.state.effects.filter((effect) => [doubleBarrel.uid, opponentControl.uid, negatable.uid].includes(effect.sourceUid ?? "")).map((effect) => ({
      sourceUid: effect.sourceUid,
      code: effect.code,
      event: effect.event,
      reset: effect.reset,
      value: effect.value,
    }))).toEqual([
      { sourceUid: doubleBarrel.uid, code: 31, event: "continuous", reset: undefined, value: undefined },
      { sourceUid: doubleBarrel.uid, code: 1027, event: "quick", reset: undefined, value: undefined },
      { sourceUid: opponentControl.uid, code: 4608, event: "continuous", reset: { flags: 1082135040, count: 1 }, value: 1 },
      { sourceUid: opponentControl.uid, code: 85, event: "continuous", reset: { flags: 1107038720 }, value: 1 },
      { sourceUid: opponentControl.uid, code: 7, event: "continuous", reset: { flags: 1107038720 }, value: 1 },
    ]);
    expect(restoredResponse.session.state.eventHistory.filter((event) => ["sentToGraveyard", "detachedMaterial", "controlChanged"].includes(event.eventName))).toEqual([
      {
        eventName: "sentToGraveyard",
        eventCode: 1014,
        eventCardUid: materialSpell.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: doubleBarrel.uid,
        eventReasonEffectId: 2,
        eventPreviousState: { controller: 0, faceUp: false, location: "overlay", position: "faceDown", sequence: 1 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
      },
      {
        eventName: "detachedMaterial",
        eventCode: 1202,
        eventCardUid: doubleBarrel.uid,
        eventPlayer: 0,
        eventValue: 0,
        eventUids: [doubleBarrel.uid],
        eventReason: 0,
        eventReasonPlayer: 0,
        eventReasonCardUid: doubleBarrel.uid,
        eventReasonEffectId: 2,
        relatedEffectId: 2,
        eventPreviousState: { controller: 0, faceUp: false, location: "extraDeck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
      {
        eventName: "controlChanged",
        eventCode: 1120,
        eventCardUid: opponentControl.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: doubleBarrel.uid,
        eventReasonEffectId: 2,
        eventPreviousState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 2 },
      },
      {
        eventName: "sentToGraveyard",
        eventCode: 1014,
        eventCardUid: opponentStarter.uid,
        eventReason: duelReason.rule,
        eventReasonPlayer: 1,
        eventPreviousState: { controller: 1, faceUp: true, location: "spellTrapZone", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 1, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
      },
    ]);
  });
});

function moveFaceUpMonster(session: DuelSession, uid: string, controller: PlayerId): DuelCardInstance {
  const card = moveDuelCard(session.state, uid, "monsterZone", controller);
  card.faceUp = true;
  card.position = "faceUpAttack";
  return card;
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
  const result = applyLuaRestoreResponse(restored, action);
  expect(result.ok, result.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(result.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(result.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
}

function resolveRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0 || restored.session.state.waitingFor !== restored.session.state.turnPlayer) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}

function starterScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_ACTIVATE)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetOperation(function(e,tp) Debug.Message("double barrel starter resolved") end)
      c:RegisterEffect(e)
    end
  `;
}
