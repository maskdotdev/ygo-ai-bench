import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Honest damage step", () => {
  it("restores Honest's damage-step hand effect and battle ATK update", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const honestCode = "37742478";
    const responderCode = "860";
    const attackerCode = "1004";
    const targetCode = "1005";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === honestCode),
      { code: responderCode, name: "Honest Chain Responder", kind: "monster", typeFlags: 0x1, level: 4 },
      { code: attackerCode, name: "Honest Light Attacker", kind: "monster", typeFlags: 0x1, level: 4, attribute: 0x10, attack: 1000, defense: 1000 },
      { code: targetCode, name: "Honest Battle Target", kind: "monster", typeFlags: 0x1, level: 4, attribute: 0x20, attack: 1800, defense: 1200 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 377, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [honestCode, attackerCode] }, 1: { main: [targetCode, responderCode] } });
    startDuel(session);

    const honest = session.state.cards.find((card) => card.code === honestCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    const attacker = session.state.cards.find((card) => card.code === attackerCode);
    const target = session.state.cards.find((card) => card.code === targetCode);
    expect(honest).toBeDefined();
    expect(responder).toBeDefined();
    expect(attacker).toBeDefined();
    expect(target).toBeDefined();
    moveDuelCard(session.state, honest!.uid, "hand", 0);
    moveDuelCard(session.state, responder!.uid, "hand", 1);
    moveDuelCard(session.state, attacker!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, target!.uid, "monsterZone", 1).position = "faceUpAttack";
    session.state.phase = "battle";
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(honestCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const attack = getLegalActions(session, 0).find((action) => action.type === "declareAttack" && action.attackerUid === attacker!.uid && action.targetUid === target!.uid);
    expect(attack).toBeDefined();
    applyAndAssert(session, attack!);
    applyAndAssert(session, getLegalActions(session, 1).find((action) => action.type === "passAttack")!);
    applyAndAssert(session, getLegalActions(session, 0).find((action) => action.type === "passAttack")!);
    expect(session.state.battleWindow?.kind).toBe("startDamageStep");

    applyAndAssert(session, getLegalActions(session, 1).find((action) => action.type === "passDamage")!);
    const honestAction = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === honest!.uid);
    expect(honestAction).toBeDefined();
    applyAndAssert(session, honestAction!);
    expect(session.state.cards.find((card) => card.uid === honest!.uid)).toMatchObject({ location: "graveyard" });
    expect(session.state.chain).toHaveLength(1);
    expect(session.state.chain[0]).toMatchObject({ sourceUid: honest!.uid });

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restoredChain.restoreComplete, restoredChain.incompleteReasons.join("; ")).toBe(true);
    expect(restoredChain.missingRegistryKeys).toEqual([]);
    expect(restoredChain.session.state.cards.find((card) => card.uid === honest!.uid)).toMatchObject({ location: "graveyard" });
    expect(restoredChain.session.state.chain).toHaveLength(1);
    expect(getLuaRestoreLegalActionGroups(restoredChain, 1)).toEqual(getGroupedDuelLegalActions(restoredChain.session, 1));
    expect(getLuaRestoreLegalActionGroups(restoredChain, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restoredChain, 1));

    const pass = getLuaRestoreLegalActions(restoredChain, 1).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    const resolved = applyLuaRestoreResponse(restoredChain, pass!);
    expect(resolved.ok, resolved.error).toBe(true);
    expect(restoredChain.session.state.chain).toHaveLength(0);
    expect(restoredChain.session.state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: "continuous",
          code: 100,
          sourceUid: attacker!.uid,
          value: 1800,
        }),
      ]),
    );

    const restoredBattle = restoreDuelWithLuaScripts(serializeDuel(restoredChain.session), source, reader);
    expect(restoredBattle.restoreComplete, restoredBattle.incompleteReasons.join("; ")).toBe(true);
    expect(restoredBattle.missingRegistryKeys).toEqual([]);
    expect(restoredBattle.session.state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: "continuous",
          code: 100,
          sourceUid: attacker!.uid,
          value: 1800,
        }),
      ]),
    );

    passBattleResponses(restoredBattle.session);
    expect(restoredBattle.session.state.battleDamage[1]).toBe(1000);
    expect(restoredBattle.session.state.players[1].lifePoints).toBe(7000);
    expect(restoredBattle.session.state.cards.find((card) => card.uid === attacker!.uid)).toMatchObject({ location: "monsterZone" });
    expect(restoredBattle.session.state.cards.find((card) => card.uid === target!.uid)).toMatchObject({ location: "graveyard" });
    expect(restoredBattle.host.messages).not.toContain("honest responder resolved");
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
      e:SetProperty(EFFECT_FLAG_DAMAGE_STEP)
      e:SetCondition(function(e,tp) return Duel.GetCurrentChain()>0 end)
      e:SetOperation(function(e,tp) Debug.Message("honest responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function passBattleResponses(session: DuelSession): void {
  while (session.state.pendingBattle) {
    const player = session.state.waitingFor ?? session.state.turnPlayer;
    const passType = session.state.battleStep === "damage" || session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLegalActions(session, player).find((action) => action.type === passType);
    expect(pass).toBeDefined();
    applyAndAssert(session, pass!);
  }
}

function applyAndAssert(session: DuelSession, action: DuelAction) {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  return response;
}
