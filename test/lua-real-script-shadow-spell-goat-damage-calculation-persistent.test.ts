import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, loadDecks, sendDuelCardToGraveyard, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelCardData, DuelResponse } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script GOAT Shadow Spell persistent damage calculation", () => {
  it("restores a damage-calculation persistent target into ATK loss before battle damage", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const shadowSpellCode = "504700050";
    const targetCode = "613921";
    const attackerCode = "613922";
    const responderCode = "613923";
    const cards: DuelCardData[] = [
      { code: shadowSpellCode, name: "Shadow Spell (GOAT)", kind: "trap", typeFlags: 0x20004 },
      { code: targetCode, name: "Shadow Spell Defender", kind: "monster", typeFlags: 0x1, level: 4, attack: 1000, defense: 1000 },
      { code: attackerCode, name: "Shadow Spell Attacker", kind: "monster", typeFlags: 0x1, level: 4, attack: 2200, defense: 1200 },
      { code: responderCode, name: "Shadow Spell Chain Responder", kind: "monster", typeFlags: 0x1, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 323, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [shadowSpellCode, targetCode] }, 1: { main: [attackerCode, responderCode] } });
    startDuel(session);

    const shadowSpell = session.state.cards.find((card) => card.code === shadowSpellCode);
    const target = session.state.cards.find((card) => card.code === targetCode);
    const attacker = session.state.cards.find((card) => card.code === attackerCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    expect(shadowSpell).toBeDefined();
    expect(target).toBeDefined();
    expect(attacker).toBeDefined();
    expect(responder).toBeDefined();
    moveDuelCard(session.state, shadowSpell!.uid, "spellTrapZone", 0);
    shadowSpell!.position = "faceDown";
    shadowSpell!.faceUp = false;
    moveDuelCard(session.state, target!.uid, "monsterZone", 0);
    target!.position = "faceUpAttack";
    target!.faceUp = true;
    moveDuelCard(session.state, attacker!.uid, "monsterZone", 1);
    attacker!.position = "faceUpAttack";
    attacker!.faceUp = true;
    moveDuelCard(session.state, responder!.uid, "hand", 1);
    session.state.turnPlayer = 1;
    session.state.phase = "battle";
    session.state.waitingFor = 1;

    const source = {
      readScript(name: string) {
        if (name === `c${shadowSpellCode}.lua`) return workspace.readScript(`goat/c${shadowSpellCode}.lua`);
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(shadowSpellCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);
    expect(session.state.effects.find((effect) => effect.sourceUid === responder!.uid)).toMatchObject({
      property: 0x8000,
      range: ["hand"],
    });

    const restoredSetup = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredSetup);
    expect(restoredSetup.session.state.effects.find((effect) => effect.sourceUid === responder!.uid)).toMatchObject({
      property: 0x8000,
      range: ["hand"],
    });
    expectRestoredLegalActions(restoredSetup, 1);
    const attack = getLuaRestoreLegalActions(restoredSetup, 1).find(
      (action) => action.type === "declareAttack" && action.attackerUid === attacker!.uid && action.targetUid === target!.uid,
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredSetup, 1), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredSetup, attack!);
    passRestoredBattleAction(restoredSetup, 0, "passAttack");
    passRestoredBattleAction(restoredSetup, 1, "passAttack");
    expect(restoredSetup.session.state.battleWindow?.kind).toBe("startDamageStep");
    expect(getLuaRestoreLegalActions(restoredSetup, 0).some((action) => action.type === "activateEffect" && action.uid === shadowSpell!.uid)).toBe(false);

    advanceRestoredBattleWindow(restoredSetup, "duringDamageCalculation", shadowSpell!.uid);
    const restoredDamageCalculation = restoreDuelWithLuaScripts(serializeDuel(restoredSetup.session), source, reader);
    expectCleanRestore(restoredDamageCalculation);
    expect(restoredDamageCalculation.session.state.battleWindow?.kind).toBe("duringDamageCalculation");
    expect(getLuaRestoreLegalActionGroups(restoredDamageCalculation, 0)).toEqual(getGroupedDuelLegalActions(restoredDamageCalculation.session, 0));
    expect(getLuaRestoreLegalActionGroups(restoredDamageCalculation, 0).flatMap((group) => group.actions)).toEqual(
      getLuaRestoreLegalActions(restoredDamageCalculation, 0),
    );

    const activation = getLuaRestoreLegalActions(restoredDamageCalculation, 0).find(
      (action) => action.type === "activateEffect" && action.uid === shadowSpell!.uid,
    );
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredDamageCalculation, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredDamageCalculation, activation!);
    expect(restoredDamageCalculation.session.state.chain[0]).toMatchObject({
      sourceUid: shadowSpell!.uid,
      targetUids: [attacker!.uid],
    });
    expect(getLuaRestoreLegalActions(restoredDamageCalculation, 1).some((action) => action.type === "activateEffect" && action.uid === responder!.uid)).toBe(true);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredDamageCalculation.session), source, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, 1);
    resolveRestoredChain(restoredChain);
    expect(restoredChain.session.state.cards.find((card) => card.uid === shadowSpell!.uid)).toMatchObject({
      location: "spellTrapZone",
      cardTargetUids: [attacker!.uid],
      faceUp: true,
    });
    expect(restoredChain.host.messages).not.toContain("shadow spell responder resolved");
    expectShadowSpellProbe(restoredChain, shadowSpellCode, attackerCode, "shadow spell persistent true/true/1/1500");

    const restoredBattle = restoreDuelWithLuaScripts(serializeDuel(restoredChain.session), source, reader);
    expectCleanRestore(restoredBattle);
    expectRestoredLegalActions(restoredBattle, 0);
    passBattleResponses(restoredBattle);
    expect(restoredBattle.session.state.battleDamage[0]).toBe(500);
    expect(restoredBattle.session.state.players[0].lifePoints).toBe(7500);
    expect(restoredBattle.session.state.cards.find((card) => card.uid === target!.uid)).toMatchObject({ location: "graveyard" });
    expect(restoredBattle.session.state.cards.find((card) => card.uid === attacker!.uid)).toMatchObject({ location: "monsterZone" });
    expect(restoredBattle.session.state.cards.find((card) => card.uid === shadowSpell!.uid)).toMatchObject({
      location: "spellTrapZone",
      cardTargetUids: [attacker!.uid],
    });

    sendDuelCardToGraveyard(restoredBattle.session.state, attacker!.uid, 1, duelReason.effect, 0);
    expect(restoredBattle.session.state.cards.find((card) => card.uid === attacker!.uid)).toMatchObject({ location: "graveyard" });
    expect(restoredBattle.session.state.cards.find((card) => card.uid === shadowSpell!.uid)).toMatchObject({
      location: "graveyard",
      previousLocation: "spellTrapZone",
      reason: duelReason.effect | duelReason.destroy,
    });
  });
});

function chainResponderScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_QUICK_O)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetRange(LOCATION_HAND)
      e:SetProperty(EFFECT_FLAG_DAMAGE_CAL)
      e:SetCondition(function(e,tp) return Duel.GetCurrentChain()>0 end)
      e:SetOperation(function(e,tp) Debug.Message("shadow spell responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function expectShadowSpellProbe(restored: ReturnType<typeof restoreDuelWithLuaScripts>, shadowSpellCode: string, attackerCode: string, message: string): void {
  const probe = restored.host.loadScript(
    `
      local trap=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${shadowSpellCode}),0,LOCATION_SZONE,0,nil)
      local attacker=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${attackerCode}),0,0,LOCATION_MZONE,nil)
      local e=Effect.CreateEffect(trap)
      Debug.Message(
        "shadow spell persistent " ..
        tostring(trap:IsHasCardTarget(attacker)) .. "/" ..
        tostring(aux.PersistentTargetFilter(e,attacker)) .. "/" ..
        trap:GetCardTargetCount() .. "/" ..
        attacker:GetAttack()
      )
    `,
    "shadow-spell-persistent-probe.lua",
  );
  expect(probe.ok, probe.error).toBe(true);
  expect(restored.host.messages).toContain(message);
}

function advanceRestoredBattleWindow(
  restored: ReturnType<typeof restoreDuelWithLuaScripts>,
  expectedKind: NonNullable<NonNullable<ReturnType<typeof restoreDuelWithLuaScripts>["session"]["state"]["battleWindow"]>["kind"]>,
  blockedUid: string,
): void {
  let guard = 0;
  while (restored.session.state.battleWindow?.kind !== expectedKind) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    expect(getLuaRestoreLegalActions(restored, player).some((action) => action.type === "activateEffect" && action.uid === blockedUid)).toBe(false);
    passRestoredBattleAction(restored, player, "passDamage");
  }
}

function passRestoredBattleAction(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1, type: "passAttack" | "passDamage"): void {
  const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === type);
  expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
  applyLuaRestoreAndAssert(restored, pass!);
}

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, response: DuelResponse): void {
  const result = applyLuaRestoreResponse(restored, response);
  expect(result.ok, result.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(result.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
    expect(result.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
    expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
  }
}

function expectCleanRestore(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
  expect(restored.missingRegistryKeys).toEqual([]);
  expect(restored.missingChainLimitRegistryKeys).toEqual([]);
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
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

function passBattleResponses(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.pendingBattle) {
    expect(++guard).toBeLessThan(20);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const passType = restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restored, pass!);
  }
}
