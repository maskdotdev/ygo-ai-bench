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
const criticalCode = "64767757";
const materiactorXyzCode = "647677570";
const overlaySpellCode = "647677571";
const opponentSpellCode = "647677572";
const defenderCode = "647677573";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasCriticalScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${criticalCode}.lua`));
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeTrap = 0x4;
const typeEffect = 0x20;
const typeXyz = 0x800000;
const raceDragon = 0x2000;
const raceWarrior = 0x1;
const attributeDark = 0x20;
const attributeEarth = 0x08;
const setMateriactor = 0x162;

describe.skipIf(!hasUpstreamScripts || !hasCriticalScript)("Lua real script Materiactor Critical overlay negate stat", () => {
  it("restores overlay Spell to hand, activation negation, and Materiactor Xyz ATK gain", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${criticalCode}.lua`));
    const reader = createCardReader(cards());
    const source = opponentSpellSource(workspace);
    const session = createDuel({ seed: 64767757, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [criticalCode, overlaySpellCode], extra: [materiactorXyzCode] }, 1: { main: [opponentSpellCode, defenderCode] } });
    startDuel(session);

    const critical = requireCard(session, criticalCode);
    const materiactorXyz = requireCard(session, materiactorXyzCode);
    const overlaySpell = requireCard(session, overlaySpellCode);
    const opponentSpell = requireCard(session, opponentSpellCode);
    const defender = requireCard(session, defenderCode);
    moveFaceDownTrap(session, critical);
    moveFaceUpAttack(session, materiactorXyz, 0, 0);
    moveFaceUpAttack(session, defender, 1, 0);
    moveOverlayMaterial(session, materiactorXyz, overlaySpell);
    moveDuelCard(session.state, opponentSpell.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 1;
    session.state.waitingFor = 1;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(criticalCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(opponentSpellCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 1);
    const spell = getLuaRestoreLegalActions(restoredOpen, 1).find((action) => action.type === "activateEffect" && action.uid === opponentSpell.uid);
    expect(spell, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 1), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, spell!);

    const restoredResponse = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
    expectCleanRestore(restoredResponse);
    expectRestoredLegalActions(restoredResponse, 0);
    const negate = getLuaRestoreLegalActions(restoredResponse, 0).find((action) => action.type === "activateEffect" && action.uid === critical.uid);
    expect(negate, JSON.stringify(getLuaRestoreLegalActions(restoredResponse, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredResponse, negate!);
    passRestoredChain(restoredResponse);

    expect(restoredResponse.host.messages).not.toContain("materiactor critical opponent spell resolved");
    expect(restoredResponse.session.state.cards.find((card) => card.uid === overlaySpell.uid)).toMatchObject({
      location: "hand",
      controller: 0,
      faceUp: false,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: critical.uid,
      reasonEffectId: 1,
    });
    expect(restoredResponse.session.state.cards.find((card) => card.uid === materiactorXyz.uid)?.overlayUids).toEqual([]);
    expect(currentAttack(restoredResponse.session.state.cards.find((card) => card.uid === materiactorXyz.uid), restoredResponse.session.state)).toBe(3000);
    expect(restoredResponse.session.state.cards.find((card) => card.uid === materiactorXyz.uid)).toMatchObject({ attackModifier: 1000 });
    expect(restoredResponse.session.state.eventHistory.filter((event) => ["sentToHand", "confirmed", "chainNegated", "chainDisabled"].includes(event.eventName))).toEqual([
      {
        eventName: "sentToHand",
        eventCode: 1012,
        eventCardUid: overlaySpell.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: critical.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 0, faceUp: false, location: "overlay", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
      },
      {
        eventName: "confirmed",
        eventCode: 1211,
        eventCardUid: overlaySpell.uid,
        eventPlayer: 1,
        eventValue: 1,
        eventUids: [overlaySpell.uid],
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: critical.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 0, faceUp: false, location: "overlay", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
      },
      {
        eventName: "chainNegated",
        eventCode: 1024,
        eventPlayer: 1,
        eventValue: 1,
        eventReasonPlayer: 1,
        eventChainDepth: 1,
        eventChainLinkId: "chain-2",
        relatedEffectId: 2,
      },
      {
        eventName: "chainDisabled",
        eventCode: 1025,
        eventPlayer: 1,
        eventValue: 1,
        eventReasonPlayer: 1,
        eventChainDepth: 1,
        eventChainLinkId: "chain-2",
        relatedEffectId: 2,
      },
    ]);

    const restoredBattle = restoreDuelWithLuaScripts(serializeDuel(restoredResponse.session), source, reader);
    expectCleanRestore(restoredBattle);
    expectRestoredLegalActions(restoredBattle, 0);
    restoredBattle.session.state.phase = "battle";
    restoredBattle.session.state.turnPlayer = 0;
    restoredBattle.session.state.waitingFor = 0;
    const attack = getLuaRestoreLegalActions(restoredBattle, 0).find((action) => action.type === "declareAttack" && action.attackerUid === materiactorXyz.uid && action.targetUid === defender.uid);
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredBattle, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredBattle, attack!);
    passRestoredBattle(restoredBattle);
    expect(restoredBattle.session.state.battleDamage).toEqual({ 0: 0, 1: 500 });
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("e1:SetCategory(CATEGORY_TOHAND+CATEGORY_NEGATE+CATEGORY_TODECK+CATEGORY_ATKCHANGE+CATEGORY_SET)");
  expect(script).toContain("e1:SetType(EFFECT_TYPE_ACTIVATE)");
  expect(script).toContain("e1:SetCode(EVENT_CHAINING)");
  expect(script).toContain("e1:SetCountLimit(1,id,EFFECT_COUNT_CODE_OATH)");
  expect(script).toContain("return (re:IsMonsterEffect() or re:IsHasType(EFFECT_TYPE_ACTIVATE)) and Duel.IsChainNegatable(ev)");
  expect(script).toContain("return s.materiactorxyzfilter(c) and c:GetOverlayGroup():IsExists(s.thfilter,1,nil,tp)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_TOHAND,nil,1,tp,LOCATION_OVERLAY)");
  expect(script).toContain("Duel.SetPossibleOperationInfo(0,CATEGORY_TODECK,nil,1,tp,LOCATION_HAND)");
  expect(script).toContain("local og=Duel.GetOverlayGroup(tp,1,0,xyzg)");
  expect(script).toContain("local sc=og:FilterSelect(tp,s.thfilter,1,1,nil,tp):GetFirst()");
  expect(script).toContain("Duel.SendtoHand(sc,nil,REASON_EFFECT)>0");
  expect(script).toContain("Duel.ConfirmCards(1-tp,sc)");
  expect(script).toContain("Duel.ShuffleHand(tp)");
  expect(script).toContain("Duel.NegateActivation(ev)");
  expect(script).toContain("tc:UpdateAttack(1000)");
}

function cards(): DuelCardData[] {
  return [
    { code: criticalCode, name: "Materiactor Critical", kind: "trap", typeFlags: typeTrap },
    { code: materiactorXyzCode, name: "Materiactor Critical Xyz", kind: "extra", typeFlags: typeMonster | typeEffect | typeXyz, race: raceDragon, attribute: attributeDark, setcodes: [setMateriactor], level: 3, attack: 2000, defense: 2000 },
    { code: overlaySpellCode, name: "Materiactor Critical Overlay Spell", kind: "spell", typeFlags: typeSpell, setcodes: [setMateriactor] },
    { code: opponentSpellCode, name: "Materiactor Critical Opponent Spell", kind: "spell", typeFlags: typeSpell },
    { code: defenderCode, name: "Materiactor Critical Defender", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 2500, defense: 1000 },
  ];
}

function opponentSpellSource(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): { readScript(name: string): string | undefined } {
  return {
    readScript(name: string) {
      if (name === `c${opponentSpellCode}.lua`) return opponentSpellScript();
      return workspace.readScript(name);
    },
  };
}

function opponentSpellScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_ACTIVATE)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetOperation(function(e,tp) Debug.Message("materiactor critical opponent spell resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceDownTrap(session: DuelSession, card: DuelCardInstance): void {
  const moved = moveDuelCard(session.state, card.uid, "spellTrapZone", 0);
  moved.faceUp = false;
  moved.position = "faceDown";
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence?: number): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  if (sequence !== undefined) moved.sequence = sequence;
}

function moveOverlayMaterial(session: DuelSession, holder: DuelCardInstance, material: DuelCardInstance): void {
  moveDuelCard(session.state, material.uid, "overlay", holder.controller, duelReason.material | duelReason.xyz);
  holder.overlayUids.push(material.uid);
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

function passRestoredBattle(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.pendingBattle || restored.session.state.currentAttack || restored.session.state.battleWindow) {
    expect(++guard).toBeLessThan(20);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const action = getLuaRestoreLegalActions(restored, player).find((candidate) => candidate.type === "passAttack" || candidate.type === "passDamage" || candidate.type === "passChain");
    expect(action, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, action!);
  }
}
