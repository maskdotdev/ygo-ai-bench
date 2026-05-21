import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack, currentDefense } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, destroyDuelCard, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { ApplyDuelResponseResult, DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const typeMonster = 0x1;
const typeNormal = 0x10;
const typeEffect = 0x20;
const typeLink = 0x4000000;
const typeSpell = 0x2;
const typeField = 0x80000;
const raceDragon = 0x2000;
const raceWarrior = 0x1;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Guardragon Shield link-stat replacement", () => {
  it("restores Field Spell activation, Link-sum Dragon stat boost, and Normal monster destroy replacement", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const shieldCode = "50186558";
    const dragonTargetCode = "501865580";
    const ownLinkCode = "501865581";
    const opponentLinkCode = "501865582";
    const normalCostCode = "501865583";
    const offRaceTargetCode = "501865584";
    const responderCode = "501865585";
    const script = workspace.readScript(`c${shieldCode}.lua`);
    expect(script).toContain("e1:SetType(EFFECT_TYPE_ACTIVATE)");
    expect(script).toContain("e2:SetRange(LOCATION_FZONE)");
    expect(script).toContain("Duel.IsExistingMatchingCard(Card.IsType,0,LOCATION_MZONE,LOCATION_MZONE,1,nil,TYPE_LINK)");
    expect(script).toContain("Duel.SelectTarget(tp,s.atkfilter,tp,LOCATION_MZONE,0,1,1,nil)");
    expect(script).toContain("return g:GetSum(Card.GetLink)*100");
    expect(script).toContain("e3:SetCode(EFFECT_DESTROY_REPLACE)");
    expect(script).toContain("Duel.SelectEffectYesNo(tp,e:GetHandler(),96)");
    expect(script).toContain("Duel.SendtoGrave(sg,REASON_EFFECT|REASON_REPLACE)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === shieldCode),
      { code: dragonTargetCode, name: "Guardragon Shield Dragon Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceDragon, level: 4, attack: 1500, defense: 1200 },
      { code: ownLinkCode, name: "Guardragon Shield Own Link", kind: "extra", typeFlags: typeMonster | typeLink, race: raceDragon, level: 3, attack: 1800, defense: 0 },
      { code: opponentLinkCode, name: "Guardragon Shield Opponent Link", kind: "extra", typeFlags: typeMonster | typeLink, race: raceWarrior, level: 2, attack: 1600, defense: 0 },
      { code: normalCostCode, name: "Guardragon Shield Normal Cost", kind: "monster", typeFlags: typeMonster | typeNormal, race: raceDragon, level: 4, attack: 1000, defense: 1000 },
      { code: offRaceTargetCode, name: "Guardragon Shield Off-Race Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, level: 4, attack: 1700, defense: 1000 },
      { code: responderCode, name: "Guardragon Shield Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 50186558, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [shieldCode, dragonTargetCode, normalCostCode], extra: [ownLinkCode] }, 1: { main: [responderCode, offRaceTargetCode], extra: [opponentLinkCode] } });
    startDuel(session);

    const shield = requireCard(session, shieldCode);
    const dragonTarget = requireCard(session, dragonTargetCode);
    const ownLink = requireCard(session, ownLinkCode);
    const opponentLink = requireCard(session, opponentLinkCode);
    const normalCost = requireCard(session, normalCostCode);
    const offRaceTarget = requireCard(session, offRaceTargetCode);
    const responder = requireCard(session, responderCode);
    moveDuelCard(session.state, shield.uid, "hand", 0);
    moveMonster(session, dragonTarget.uid, 0, 0);
    moveMonster(session, ownLink.uid, 0, 1);
    moveMonster(session, opponentLink.uid, 1, 0);
    moveMonster(session, offRaceTarget.uid, 1, 1);
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
    expect(host.loadCardScript(Number(shieldCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredActivation = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredActivation);
    expectRestoredLegalActions(restoredActivation, 0);
    const activate = getLuaRestoreLegalActions(restoredActivation, 0).find((action) => action.type === "activateEffect" && action.uid === shield.uid);
    expect(activate, JSON.stringify(getLuaRestoreLegalActions(restoredActivation, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredActivation, activate!);

    const restoredActivationChain = restoreDuelWithLuaScripts(serializeDuel(restoredActivation.session), source, reader);
    expectCleanRestore(restoredActivationChain);
    expectRestoredLegalActions(restoredActivationChain, 1);
    expect(getLuaRestoreLegalActions(restoredActivationChain, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);
    resolveRestoredChain(restoredActivationChain);
    expect(restoredActivationChain.host.messages).not.toContain("guardragon shield responder resolved");
    expect(restoredActivationChain.session.state.cards.find((card) => card.uid === shield.uid)).toMatchObject({
      location: "spellTrapZone",
      controller: 0,
      faceUp: true,
    });
    expect(restoredActivationChain.session.state.cards.find((card) => card.uid === shield.uid)?.data.typeFlags ?? 0).toBe(typeSpell | typeField);

    const restoredBoost = restoreDuelWithLuaScripts(serializeDuel(restoredActivationChain.session), source, reader);
    expectCleanRestore(restoredBoost);
    expectRestoredLegalActions(restoredBoost, 0);
    const boost = getLuaRestoreLegalActions(restoredBoost, 0).find((action) => action.type === "activateEffect" && action.uid === shield.uid);
    expect(boost, JSON.stringify(getLuaRestoreLegalActions(restoredBoost, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredBoost, boost!);
    expect(restoredBoost.session.state.chain[0]?.targetUids).toEqual([dragonTarget.uid]);
    resolveRestoredChain(restoredBoost);
    expect(currentAttack(dragonTarget, restoredBoost.session.state)).toBe(2000);
    expect(currentDefense(dragonTarget, restoredBoost.session.state)).toBe(1700);
    expect(currentAttack(offRaceTarget, restoredBoost.session.state)).toBe(1700);
    expect(restoredBoost.session.state.effects
      .filter((effect) => effect.sourceUid === dragonTarget.uid && (effect.code === 100 || effect.code === 104))
      .map((effect) => ({
        code: effect.code,
        registryKey: effect.registryKey,
        range: effect.range,
        luaValueDescriptor: effect.luaValueDescriptor,
      }))).toEqual([
        { code: 100, registryKey: "lua:50186558:lua-5-100", range: ["monsterZone"], luaValueDescriptor: "stat:matching-type-sum-link:player0:4:4:67108864:x100" },
        { code: 104, registryKey: "lua:50186558:lua-6-104", range: ["monsterZone"], luaValueDescriptor: "stat:matching-type-sum-link:player0:4:4:67108864:x100" },
      ]);

    const restoredStatEffects = restoreDuelWithLuaScripts(serializeDuel(restoredBoost.session), source, reader);
    expectCleanRestore(restoredStatEffects);
    expectRestoredLegalActions(restoredStatEffects, 0);
    expect(currentAttack(dragonTarget, restoredStatEffects.session.state)).toBe(2000);
    expect(currentDefense(dragonTarget, restoredStatEffects.session.state)).toBe(1700);

    const restoredBattle = restoreDuelWithLuaScripts(serializeDuel(restoredStatEffects.session), source, reader);
    expectCleanRestore(restoredBattle);
    restoredBattle.session.state.phase = "battle";
    restoredBattle.session.state.waitingFor = 0;
    const attack = getLuaRestoreLegalActions(restoredBattle, 0).find((action) => action.type === "declareAttack" && action.attackerUid === dragonTarget.uid && action.targetUid === offRaceTarget.uid);
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredBattle, 0), null, 2)).toBeDefined();
    applyAndAssert(restoredBattle.session, attack!);
    passBattleResponses(restoredBattle.session);
    expect(restoredBattle.session.state.battleDamage[1]).toBe(300);
    expect(restoredBattle.session.state.players[1].lifePoints).toBe(7700);

    const restoredReplacement = restoreDuelWithLuaScripts(serializeDuel(restoredStatEffects.session), source, reader);
    expectCleanRestore(restoredReplacement);
    expectRestoredLegalActions(restoredReplacement, 0);
    destroyDuelCard(restoredReplacement.session.state, dragonTarget.uid, 0, duelReason.effect | duelReason.destroy, 1);
    expect(restoredReplacement.host.promptDecisions).toEqual([
      { id: "lua-prompt-1", api: "SelectEffectYesNo", player: 0, description: 96, returned: true },
    ]);
    expect(restoredReplacement.session.state.cards.find((card) => card.uid === dragonTarget.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
    });
    expect(restoredReplacement.session.state.cards.find((card) => card.uid === normalCost.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.effect | duelReason.replace,
      reasonPlayer: 0,
      reasonCardUid: shield.uid,
      reasonEffectId: 3,
    });
    expect(restoredReplacement.session.state.log.filter((entry) => entry.action === "destroyReplace")).toEqual([
      { step: 8, action: "destroyReplace", player: 0, card: dragonTarget.name, detail: "Destruction replaced" },
    ]);
  });
});

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveMonster(session: DuelSession, uid: string, player: 0 | 1, sequence: number): void {
  const moved = moveDuelCard(session.state, uid, "monsterZone", player);
  moved.sequence = sequence;
  moved.faceUp = true;
  moved.position = "faceUpAttack";
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
      e:SetOperation(function(e,tp) Debug.Message("guardragon shield responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function expectCleanRestore(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
  expect(restored.missingRegistryKeys).toEqual([]);
  expect(restored.missingChainLimitRegistryKeys).toEqual([]);
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
    expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
    expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  }
}

function applyAndAssert(session: DuelSession, action: DuelAction): ApplyDuelResponseResult {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = response.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(response.legalActions).toEqual(getLegalActions(session, waitingFor));
    expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, waitingFor));
    expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  }
  return response;
}

function passBattleResponses(session: DuelSession): void {
  let guard = 0;
  while (session.state.pendingBattle) {
    expect(++guard).toBeLessThan(20);
    const player = session.state.waitingFor ?? session.state.turnPlayer;
    const passType = session.state.battleStep === "damage" || session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLegalActions(session, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLegalActions(session, player), null, 2)).toBeDefined();
    applyAndAssert(session, pass!);
  }
}

function resolveRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restored, pass!);
  }
}
