import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelResponse, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const maleficCyberEndCode = "1710476";
const hasMaleficCyberEndScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${maleficCyberEndCode}.lua`));
const cyberEndCode = "1546123";
const allyCode = "17104760";
const targetCode = "17104761";
const fieldSpellCode = "17104762";
const dummySpellCode = "17104763";
const typeMonster = 0x1;
const typeFusion = 0x40;
const typeSpell = 0x2;
const typeField = 0x80000;
const setMalefic = 0x23;

describe.skipIf(!hasUpstreamScripts || !hasMaleficCyberEndScript)("Lua real script Malefic Cyber End attack lock and self destroy", () => {
  it("restores Malefic Extra Deck summon, other-monster attack lock, and missing-field self-destroy", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`c${maleficCyberEndCode}.lua`) ?? "";
    expect(script).toContain("aux.AddMaleficSummonProcedure(c,1546123,LOCATION_EXTRA)");
    expect(script).toContain("c:SetUniqueOnField(1,1,aux.MaleficUniqueFilter(c),LOCATION_MZONE)");
    expect(script).toContain("e7:SetCode(EFFECT_SELF_DESTROY)");
    expect(script).toContain("return not Duel.IsExistingMatchingCard(Card.IsFaceup,0,LOCATION_FZONE,LOCATION_FZONE,1,nil)");
    expect(script).toContain("e8:SetCode(EFFECT_CANNOT_ATTACK_ANNOUNCE)");
    expect(script).toContain("return c~=e:GetHandler()");
    expect(script).toContain("e9:SetCode(EFFECT_SPSUMMON_CONDITION)");
    expect(script).toContain("e9:SetValue(aux.FALSE)");

    const cards: DuelCardData[] = [
      { code: maleficCyberEndCode, name: "Malefic Cyber End Dragon", kind: "monster", typeFlags: typeMonster, setcodes: [setMalefic], level: 10, attack: 4000, defense: 2800 },
      { code: cyberEndCode, name: "Cyber End Dragon", kind: "monster", typeFlags: typeMonster | typeFusion, level: 10, attack: 4000, defense: 2800 },
      { code: allyCode, name: "Malefic Locked Ally", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1800, defense: 1000 },
      { code: targetCode, name: "Malefic Battle Target", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000 },
      { code: fieldSpellCode, name: "Malefic Field Spell", kind: "spell", typeFlags: typeSpell | typeField },
      { code: dummySpellCode, name: "Malefic Dummy Spell", kind: "spell", typeFlags: typeSpell },
    ];
    const reader = createCardReader(cards);
    const source = {
      readScript(name: string) {
        if (name === `c${dummySpellCode}.lua`) return dummySpellScript();
        return workspace.readScript(name);
      },
    };

    const restoredSummon = createRestoredSummonWindow(reader, source, workspace);
    expectCleanRestore(restoredSummon);
    expectRestoredLegalActions(restoredSummon, 0);
    const malefic = requireCard(restoredSummon.session, maleficCyberEndCode);
    const cyberEnd = requireCard(restoredSummon.session, cyberEndCode);
    const ally = requireCard(restoredSummon.session, allyCode);
    const target = requireCard(restoredSummon.session, targetCode);
    const fieldSpell = requireCard(restoredSummon.session, fieldSpellCode);
    const procedure = getLuaRestoreLegalActions(restoredSummon, 0).find((action) => action.type === "specialSummonProcedure" && action.uid === malefic.uid);
    expect(procedure, JSON.stringify(getLuaRestoreLegalActions(restoredSummon, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredSummon, procedure!);
    expect(restoredSummon.session.state.cards.find((card) => card.uid === malefic.uid)).toMatchObject({ location: "monsterZone", controller: 0, summonType: "special" });
    expect(restoredSummon.session.state.cards.find((card) => card.uid === cyberEnd.uid)).toMatchObject({
      location: "banished",
      controller: 0,
      reason: duelReason.cost,
      reasonCardUid: malefic.uid,
      reasonEffectId: 2,
    });
    expect(restoredSummon.session.state.cards.find((card) => card.uid === fieldSpell.uid)).toMatchObject({ location: "spellTrapZone", controller: 0, faceUp: true, sequence: 5 });

    const restoredBattle = restoreDuelWithLuaScripts(serializeDuel(restoredSummon.session), source, reader);
    expectCleanRestore(restoredBattle);
    expectRestoredLegalActions(restoredBattle, 0);
    expect(restoredBattle.session.state.effects.find((effect) => effect.sourceUid === malefic.uid && effect.code === 86)).toMatchObject({
      event: "continuous",
      range: ["monsterZone"],
      targetRange: [4, 0],
    });
    expect(restoredBattle.session.state.effects.find((effect) => effect.sourceUid === malefic.uid && effect.code === 141)).toMatchObject({
      event: "continuous",
      range: ["monsterZone"],
      property: 0x20000,
    });
    restoredBattle.session.state.phase = "battle";
    restoredBattle.session.state.waitingFor = 0;
    expect(restoredBattle.host.loadScript(canAttackProbe(maleficCyberEndCode, allyCode), "malefic-cyber-end-attack-probe.lua").ok).toBe(true);
    expect(restoredBattle.host.messages).toContain("malefic cyber end CanAttack true/false");
    const battleActions = getLuaRestoreLegalActions(restoredBattle, 0);
    expect(hasAttack(battleActions, malefic.uid, target.uid)).toBe(true);
    expect(hasAttack(battleActions, ally.uid, target.uid)).toBe(false);

    const unprotected = createRestoredSelfDestroyWindow(reader, source, workspace);
    expectCleanRestore(unprotected);
    expectRestoredLegalActions(unprotected, 0);
    const unprotectedMalefic = requireCard(unprotected.session, maleficCyberEndCode);
    const dummySpell = requireCard(unprotected.session, dummySpellCode);
    activateAndResolveDummySpell(unprotected, dummySpell.uid);
    expect(unprotected.session.state.cards.find((card) => card.uid === unprotectedMalefic.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.effect | duelReason.destroy,
      reasonCardUid: unprotectedMalefic.uid,
      reasonEffectId: 3,
    });
    expect(unprotected.session.state.eventHistory.filter((event) => event.eventName === "destroyed" && event.eventCardUid === unprotectedMalefic.uid)).toEqual([
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: unprotectedMalefic.uid,
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonCardUid: unprotectedMalefic.uid,
        eventReasonEffectId: 3,
        eventReasonPlayer: 0,
        eventPreviousState: {
          controller: 0,
          faceUp: true,
          location: "monsterZone",
          position: "faceUpAttack",
          sequence: 0,
        },
        eventCurrentState: {
          controller: 0,
          faceUp: true,
          location: "graveyard",
          position: "faceUpAttack",
          sequence: 1,
        },
      },
    ]);
  });
});

function createRestoredSummonWindow(
  reader: ReturnType<typeof createCardReader>,
  source: { readScript(name: string): string | undefined },
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>,
): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 1710476, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [maleficCyberEndCode, allyCode, fieldSpellCode], extra: [cyberEndCode] }, 1: { main: [targetCode] } });
  startDuel(session);
  const malefic = requireCard(session, maleficCyberEndCode);
  const cyberEnd = requireCard(session, cyberEndCode);
  const ally = requireCard(session, allyCode);
  const target = requireCard(session, targetCode);
  const fieldSpell = requireCard(session, fieldSpellCode);
  moveDuelCard(session.state, malefic.uid, "hand", 0);
  moveDuelCard(session.state, cyberEnd.uid, "extraDeck", 0);
  moveFaceUpAttack(session, ally, 0);
  moveFaceUpAttack(session, target, 1);
  const field = moveDuelCard(session.state, fieldSpell.uid, "spellTrapZone", 0);
  field.sequence = 5;
  field.faceUp = true;
  field.position = "faceUpAttack";
  session.state.phase = "main1";
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(maleficCyberEndCode), source).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
}

function createRestoredSelfDestroyWindow(
  reader: ReturnType<typeof createCardReader>,
  source: { readScript(name: string): string | undefined },
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>,
): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 1710477, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [maleficCyberEndCode, allyCode, dummySpellCode] }, 1: { main: [targetCode] } });
  startDuel(session);
  moveFaceUpAttack(session, requireCard(session, maleficCyberEndCode), 0);
  moveFaceUpAttack(session, requireCard(session, allyCode), 0);
  moveFaceUpAttack(session, requireCard(session, targetCode), 1);
  moveDuelCard(session.state, requireCard(session, dummySpellCode).uid, "hand", 0);
  session.state.turn = 2;
  session.state.turnPlayer = 0;
  session.state.phase = "main1";
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(maleficCyberEndCode), source).ok).toBe(true);
  expect(host.loadCardScript(Number(dummySpellCode), source).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(2);
  return restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
}

function activateAndResolveDummySpell(restored: ReturnType<typeof restoreDuelWithLuaScripts>, dummyUid: string): void {
  const activate = getLuaRestoreLegalActions(restored, 0).find((action) => action.type === "activateEffect" && action.uid === dummyUid);
  expect(activate, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
  applyLuaRestoreAndAssert(restored, activate!);
  while (restored.session.state.chain.length > 0) {
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restored, pass!);
  }
  expect(restored.host.messages).toContain("malefic dummy resolved");
}

function canAttackProbe(maleficCode: string, allyCodeValue: string): string {
  return `
    local malefic=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${maleficCode}),0,LOCATION_MZONE,0,nil)
    local ally=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${allyCodeValue}),0,LOCATION_MZONE,0,nil)
    Debug.Message("malefic cyber end CanAttack " .. tostring(malefic and malefic:CanAttack()) .. "/" .. tostring(ally and ally:CanAttack()))
  `;
}

function dummySpellScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_ACTIVATE)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetOperation(function(e,tp) Debug.Message("malefic dummy resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function moveFaceUpAttack(session: DuelSession, card: DuelSession["state"]["cards"][number], player: PlayerId): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
}

function hasAttack(actions: DuelAction[], attackerUid: string, targetUid: string): boolean {
  return actions.some((action) => action.type === "declareAttack" && action.attackerUid === attackerUid && action.targetUid === targetUid);
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

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, response: DuelResponse): void {
  const result = applyLuaRestoreResponse(restored, response);
  expect(result.ok, result.error).toBe(true);
  const waitingFor = result.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(result.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
    expect(result.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  }
  expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
}

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}
