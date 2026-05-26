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
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const slashCode = "18563744";
const hasSlashScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${slashCode}.lua`));
const targetCode = "185637440";
const searchCode = "185637441";
const decoyCode = "185637442";
const responderCode = "185637443";
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeQuickPlay = 0x10000;
const raceWarrior = 0x1;
const attributeLight = 0x10;
const setSilentSwordsman = 0xe7;

describe.skipIf(!hasUpstreamScripts || !hasSlashScript)("Lua real script Silent Sword Slash stat immune search", () => {
  it("restores targeted Silent Swordsman stat immunity and grave self-banish search", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${slashCode}.lua`);
    expect(script).toContain("e1:SetCategory(CATEGORY_ATKCHANGE+CATEGORY_DEFCHANGE)");
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET+EFFECT_FLAG_DAMAGE_STEP+EFFECT_FLAG_CANNOT_DISABLE+EFFECT_FLAG_CANNOT_INACTIVATE+EFFECT_FLAG_CANNOT_NEGATE)");
    expect(script).toContain("e1:SetCondition(aux.StatChangeDamageStepCondition)");
    expect(script).toContain("Duel.SelectTarget(tp,s.filter,tp,LOCATION_MZONE,0,1,1,nil)");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e1:SetValue(1500)");
    expect(script).toContain("e2:SetCode(EFFECT_UPDATE_DEFENSE)");
    expect(script).toContain("e3:SetCode(EFFECT_IMMUNE_EFFECT)");
    expect(script).toContain("return e:GetOwnerPlayer()~=re:GetOwnerPlayer()");
    expect(script).toContain("e2:SetCost(Cost.SelfBanish)");
    expect(script).toContain("Duel.SelectMatchingCard(tp,s.thfilter,tp,LOCATION_DECK,0,1,1,nil)");
    expect(script).toContain("Duel.SendtoHand(g,nil,REASON_EFFECT)");
    expect(script).toContain("Duel.ConfirmCards(1-tp,g)");

    const cards: DuelCardData[] = [
      { code: slashCode, name: "Silent Sword Slash", kind: "spell", typeFlags: typeSpell | typeQuickPlay },
      { code: targetCode, name: "Silent Swordsman Target", kind: "monster", typeFlags: typeMonster, race: raceWarrior, attribute: attributeLight, level: 4, attack: 1500, defense: 1000, setcodes: [setSilentSwordsman] },
      { code: searchCode, name: "Silent Swordsman Search", kind: "monster", typeFlags: typeMonster, race: raceWarrior, attribute: attributeLight, level: 4, attack: 1000, defense: 1000, setcodes: [setSilentSwordsman] },
      { code: decoyCode, name: "Silent Sword Slash Spell Decoy", kind: "spell", typeFlags: typeSpell, setcodes: [setSilentSwordsman] },
      { code: responderCode, name: "Silent Sword Slash Chain Responder", kind: "monster", typeFlags: typeMonster, race: raceWarrior, attribute: attributeLight, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 18563744, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [slashCode, targetCode, searchCode, decoyCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const slash = requireCard(session, slashCode);
    const target = requireCard(session, targetCode);
    const search = requireCard(session, searchCode);
    const decoy = requireCard(session, decoyCode);
    const responder = requireCard(session, responderCode);
    moveDuelCard(session.state, slash.uid, "hand", 0);
    moveFaceUpAttack(session, target, 0);
    moveDuelCard(session.state, responder.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(slashCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);
    expect(session.state.effects.filter((effect) => effect.sourceUid === slash.uid).map((effect) => ({
      event: effect.event,
      code: effect.code,
      property: effect.property,
      range: effect.range,
      category: effect.category,
    }))).toEqual([
      { event: "quick", code: 1002, property: 0x2004610, range: ["hand", "spellTrapZone"], category: 0x200000 | 0x400000 },
      { event: "ignition", code: undefined, property: undefined, range: ["graveyard"], category: 0x8 | 0x20000 },
    ]);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const activate = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === slash.uid);
    expect(activate, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, activate!);
    expect(restoredOpen.session.state.chain).toEqual([
      {
        id: "chain-2",
        chainIndex: 1,
        effectId: "lua-1-1002",
        sourceUid: slash.uid,
        player: 0,
        activationLocation: "hand",
        activationSequence: 0,
        targetFieldIds: [7],
        targetUids: [target.uid],
      },
    ]);
    expect(getLuaRestoreLegalActions(restoredOpen, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);
    resolveRestoredChain(restoredOpen);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === slash.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.rule,
      reasonPlayer: 0,
    });
    expect(currentAttack(restoredOpen.session.state.cards.find((card) => card.uid === target.uid), restoredOpen.session.state)).toBe(3000);
    expect(currentDefense(restoredOpen.session.state.cards.find((card) => card.uid === target.uid), restoredOpen.session.state)).toBe(2500);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === target.uid).map((effect) => ({
      code: effect.code,
      value: effect.value,
      property: effect.property,
      range: effect.range,
      ownerPlayer: effect.ownerPlayer,
      luaValueDescriptor: effect.luaValueDescriptor,
    }))).toEqual([
      { code: 100, value: 1500, property: undefined, range: ["monsterZone"], ownerPlayer: undefined, luaValueDescriptor: undefined },
      { code: 104, value: 1500, property: undefined, range: ["monsterZone"], ownerPlayer: undefined, luaValueDescriptor: undefined },
      { code: 1, value: undefined, property: 0x4020000, range: ["monsterZone"], ownerPlayer: 0, luaValueDescriptor: "immune-effect:opponent-card-effects" },
    ]);
    expect(restoredOpen.session.state.eventHistory.filter((event) => event.eventName === "becameTarget")).toEqual([
      {
        eventName: "becameTarget",
        eventCode: 1028,
        eventCardUid: target.uid,
        eventReason: 0,
        eventReasonPlayer: 0,
        relatedEffectId: 1,
        eventChainDepth: 1,
        eventChainLinkId: "chain-2",
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 3 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
    ]);

    const restoredGrave = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
    expectCleanRestore(restoredGrave);
    expectRestoredLegalActions(restoredGrave, 0);
    const searchAction = getLuaRestoreLegalActions(restoredGrave, 0).find((action) => action.type === "activateEffect" && action.uid === slash.uid);
    expect(searchAction, JSON.stringify(getLuaRestoreLegalActions(restoredGrave, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredGrave, searchAction!);
    expect(restoredGrave.session.state.chain).toEqual([
      {
        id: "chain-6",
        chainIndex: 1,
        effectId: "lua-2",
        sourceUid: slash.uid,
        player: 0,
        activationLocation: "graveyard",
        activationSequence: 0,
        operationInfos: [{ category: 0x8, targetUids: [], count: 1, player: 0, parameter: 0x1 }],
      },
    ]);
    expect(restoredGrave.session.state.cards.find((card) => card.uid === slash.uid)).toMatchObject({
      location: "banished",
      controller: 0,
      faceUp: true,
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: slash.uid,
      reasonEffectId: 2,
    });
    resolveRestoredChain(restoredGrave);
    expect(restoredGrave.host.messages).toContain(`confirmed 1: ${searchCode}`);
    expect(restoredGrave.session.state.cards.find((card) => card.uid === search.uid)).toMatchObject({
      location: "hand",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: slash.uid,
      reasonEffectId: 2,
    });
    expect(restoredGrave.session.state.cards.find((card) => card.uid === decoy.uid)).toMatchObject({ location: "deck", controller: 0 });
    expect(restoredGrave.session.state.eventHistory.filter((event) => ["banished", "sentToHand", "confirmed", "sentToHandConfirmed"].includes(event.eventName))).toEqual([
      {
        eventName: "banished",
        eventCode: 1011,
        eventCardUid: slash.uid,
        eventReason: duelReason.cost,
        eventReasonPlayer: 0,
        eventReasonCardUid: slash.uid,
        eventReasonEffectId: 2,
        eventPreviousState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "banished", position: "faceDown", sequence: 0 },
      },
      {
        eventName: "sentToHand",
        eventCode: 1012,
        eventCardUid: search.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: slash.uid,
        eventReasonEffectId: 2,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 1 },
        eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
      },
      {
        eventName: "confirmed",
        eventCode: 1211,
        eventCardUid: search.uid,
        eventPlayer: 1,
        eventValue: 1,
        eventUids: [search.uid],
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: slash.uid,
        eventReasonEffectId: 2,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 1 },
        eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
      },
      {
        eventName: "sentToHandConfirmed",
        eventCode: 1212,
        eventCardUid: search.uid,
        eventPlayer: 1,
        eventValue: 1,
        eventUids: [search.uid],
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: slash.uid,
        eventReasonEffectId: 2,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 1 },
        eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
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

function chainResponderScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_QUICK_O)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetRange(LOCATION_HAND)
      e:SetCondition(function(e,tp) return Duel.GetCurrentChain()>0 end)
      e:SetOperation(function(e,tp) Debug.Message("silent sword slash responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}
