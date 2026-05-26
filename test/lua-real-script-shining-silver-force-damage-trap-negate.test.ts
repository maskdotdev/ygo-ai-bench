import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const silverForceCode = "89563150";
const burnTrapCode = "895631500";
const extraBackrowCode = "895631501";
const followupCode = "895631502";
const hasSilverForceScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${silverForceCode}.lua`));
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeTrap = 0x4;
const typeContinuous = 0x20000;

describe.skipIf(!hasUpstreamScripts || !hasSilverForceScript)("Lua real script Shining Silver Force damage Trap negate", () => {
  it("restores Trap damage-operation negation and destroys opponent face-up backrow", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${silverForceCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards());
    const session = createDuel({ seed: 89563150, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [silverForceCode, followupCode] }, 1: { main: [burnTrapCode, extraBackrowCode] } });
    startDuel(session);

    const silverForce = requireCard(session, silverForceCode);
    const burnTrap = requireCard(session, burnTrapCode);
    const extraBackrow = requireCard(session, extraBackrowCode);
    const followup = requireCard(session, followupCode);
    moveDuelCard(session.state, silverForce.uid, "spellTrapZone", 0);
    silverForce.position = "faceDown";
    silverForce.faceUp = false;
    moveDuelCard(session.state, followup.uid, "hand", 0);
    moveDuelCard(session.state, burnTrap.uid, "spellTrapZone", 1);
    burnTrap.position = "faceDown";
    burnTrap.faceUp = false;
    moveDuelCard(session.state, extraBackrow.uid, "spellTrapZone", 1);
    extraBackrow.sequence = 1;
    extraBackrow.position = "faceUpAttack";
    extraBackrow.faceUp = true;
    session.state.turn = 2;
    session.state.phase = "main1";
    session.state.turnPlayer = 1;
    session.state.waitingFor = 1;

    const source = {
      readScript(name: string) {
        if (name === `c${burnTrapCode}.lua`) return burnTrapScript();
        if (name === `c${followupCode}.lua`) return followupScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(silverForceCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(burnTrapCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(followupCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(3);

    const burnAction = getLegalActions(session, 1).find((action) => action.type === "activateEffect" && action.uid === burnTrap.uid);
    expect(burnAction, JSON.stringify(getLegalActions(session, 1), null, 2)).toBeDefined();
    applyAndAssert(session, burnAction!);
    expect(session.state.chain).toEqual([
      {
        id: "chain-2",
        chainIndex: 1,
        effectId: "lua-3-1002",
        sourceUid: burnTrap.uid,
        player: 1,
        activationLocation: "spellTrapZone",
        activationSequence: 0,
        operationInfos: [{ category: 0x80000, targetUids: [], count: 0, player: 0, parameter: 1500 }],
      },
    ]);

    const restoredOpenChain = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpenChain);
    expectRestoredLegalActions(restoredOpenChain, 0);
    const silverForceAction = getLuaRestoreLegalActions(restoredOpenChain, 0).find((action) => action.type === "activateEffect" && action.uid === silverForce.uid);
    expect(silverForceAction, JSON.stringify(getLuaRestoreLegalActions(restoredOpenChain, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpenChain, silverForceAction!);
    expect(restoredOpenChain.session.state.chain).toHaveLength(2);
    expect(restoredOpenChain.session.state.chain[1]).toEqual({
      id: "chain-3",
      chainIndex: 2,
      effectId: "lua-1-1027",
      sourceUid: silverForce.uid,
      player: 0,
      activationLocation: "spellTrapZone",
      activationSequence: 0,
      eventName: "chaining",
      eventCode: 1027,
      eventCardUid: burnTrap.uid,
      eventPlayer: 1,
      eventValue: 1,
      eventReasonPlayer: 1,
      eventChainDepth: 1,
      eventChainLinkId: "chain-2",
      eventPreviousState: { controller: 1, faceUp: false, location: "deck", position: "faceDown", sequence: 1 },
      eventCurrentState: { controller: 1, faceUp: true, location: "spellTrapZone", position: "faceDown", sequence: 0 },
      operationInfos: [
        { category: 0x10000000, targetUids: [burnTrap.uid], count: 1, player: 0, parameter: 0 },
        { category: 0x1, targetUids: [burnTrap.uid, extraBackrow.uid], count: 2, player: 0, parameter: 0 },
      ],
    });
    resolveRestoredChain(restoredOpenChain);
    expect(restoredOpenChain.session.state.chain).toHaveLength(0);
    expect(restoredOpenChain.session.state.cards.find((card) => card.uid === silverForce.uid)).toMatchObject({ location: "graveyard" });
    expect(restoredOpenChain.session.state.cards.find((card) => card.uid === burnTrap.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.effect | duelReason.destroy,
      reasonPlayer: 0,
      reasonCardUid: silverForce.uid,
      reasonEffectId: 1,
    });
    expect(restoredOpenChain.session.state.cards.find((card) => card.uid === extraBackrow.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.effect | duelReason.destroy,
      reasonPlayer: 0,
      reasonCardUid: silverForce.uid,
      reasonEffectId: 1,
    });
    expect(restoredOpenChain.session.state.players[0].lifePoints).toBe(8000);
    expect(restoredOpenChain.host.messages).not.toContain("silver force burn resolved");
    expect(restoredOpenChain.host.messages).not.toContain("silver force followup resolved");
    expect(restoredOpenChain.session.state.eventHistory.filter((event) => ["chainNegated", "chainDisabled"].includes(event.eventName))).toEqual([
      {
        eventName: "chainNegated",
        eventCode: 1024,
        eventPlayer: 1,
        eventValue: 1,
        eventReasonPlayer: 1,
        eventChainDepth: 1,
        eventChainLinkId: "chain-2",
        relatedEffectId: 3,
      },
      {
        eventName: "chainDisabled",
        eventCode: 1025,
        eventPlayer: 1,
        eventValue: 1,
        eventReasonPlayer: 1,
        eventChainDepth: 1,
        eventChainLinkId: "chain-2",
        relatedEffectId: 3,
      },
    ]);
    expect(restoredOpenChain.session.state.eventHistory.filter((event) => event.eventName === "damageDealt")).toEqual([]);
  });
});

function cards(): DuelCardData[] {
  return [
    { code: silverForceCode, name: "Shining Silver Force", kind: "trap", typeFlags: typeTrap },
    { code: burnTrapCode, name: "Silver Force Fixture Burn Trap", kind: "trap", typeFlags: typeTrap },
    { code: extraBackrowCode, name: "Silver Force Face-up Continuous Spell", kind: "spell", typeFlags: typeSpell | typeContinuous },
    { code: followupCode, name: "Silver Force Followup Responder", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000 },
  ];
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Shining Silver Force");
  expect(script).toContain("e1:SetCategory(CATEGORY_NEGATE+CATEGORY_DESTROY)");
  expect(script).toContain("e1:SetType(EFFECT_TYPE_ACTIVATE)");
  expect(script).toContain("e1:SetCode(EVENT_CHAINING)");
  expect(script).toContain("re:IsTrapEffect()");
  expect(script).toContain("Duel.GetOperationInfo(ev,CATEGORY_DAMAGE)");
  expect(script).toContain("Duel.GetOperationInfo(ev,CATEGORY_RECOVER)");
  expect(script).toContain("Duel.IsPlayerAffectedByEffect(cp,EFFECT_REVERSE_RECOVER)");
  expect(script).toContain("return c:IsFaceup() and c:IsSpellTrap()");
  expect(script).toContain("Duel.GetMatchingGroup(s.dfilter,tp,0,LOCATION_ONFIELD,nil)");
  expect(script).toContain("Duel.NegateActivation(ev)");
  expect(script).toContain("Duel.Destroy(g,REASON_EFFECT)");
}

function burnTrapScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetCategory(CATEGORY_DAMAGE)
      e:SetType(EFFECT_TYPE_ACTIVATE)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetTarget(function(e,tp,eg,ep,ev,re,r,rp,chk)
        if chk==0 then return true end
        Duel.SetOperationInfo(0,CATEGORY_DAMAGE,nil,0,1-tp,1500)
      end)
      e:SetOperation(function(e,tp) Debug.Message("silver force burn resolved") Duel.Damage(1-tp,1500,REASON_EFFECT) end)
      c:RegisterEffect(e)
    end
  `;
}

function followupScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_QUICK_O)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetRange(LOCATION_HAND)
      e:SetCondition(function(e,tp) return Duel.GetCurrentChain()>1 end)
      e:SetOperation(function(e,tp) Debug.Message("silver force followup resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function applyAndAssert(session: DuelSession, action: DuelAction): void {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
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
  const waitingFor = restored.session.state.waitingFor;
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
