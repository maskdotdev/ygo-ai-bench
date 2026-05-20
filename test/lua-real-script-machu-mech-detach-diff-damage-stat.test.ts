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
const machuCode = "39139935";
const materialCode = "391399350";
const targetCode = "391399351";
const responderCode = "391399352";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasMachuScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${machuCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeXyz = 0x800000;

describe.skipIf(!hasUpstreamScripts || !hasMachuScript)("Lua real script Machu Mech detach diff damage stat", () => {
  it("restores detach cost into base/current ATK delta damage and applied-damage ATK gain", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${machuCode}.lua`);
    expect(script).toContain("Xyz.AddProcedure(c,nil,5,2)");
    expect(script).toContain("e1:SetCategory(CATEGORY_DAMAGE+CATEGORY_ATKCHANGE)");
    expect(script).toContain("e1:SetType(EFFECT_TYPE_IGNITION)");
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET)");
    expect(script).toContain("e1:SetCost(Cost.DetachFromSelf(1))");
    expect(script).toContain("return c:IsFaceup() and c:GetAttack()~=c:GetBaseAttack()");
    expect(script).toContain("Duel.SelectTarget(tp,s.filter,tp,0,LOCATION_MZONE,1,1,nil)");
    expect(script).toContain("local atk=tc:GetAttack()");
    expect(script).toContain("local batk=tc:GetBaseAttack()");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_DAMAGE,nil,0,1-tp,(batk>atk) and (batk-atk) or (atk-batk))");
    expect(script).toContain("local dam=Duel.Damage(1-tp,dif,REASON_EFFECT)");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e1:SetValue(dam)");

    const cards: DuelCardData[] = [
      { code: machuCode, name: "Number 33: Chronomaly Machu Mech", kind: "extra", typeFlags: typeMonster | typeEffect | typeXyz, level: 5, attack: 2400, defense: 1500 },
      { code: materialCode, name: "Machu Mech Overlay Material", kind: "monster", typeFlags: typeMonster, level: 5, attack: 1000, defense: 1000 },
      { code: targetCode, name: "Machu Mech Debuffed Target", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 2000, defense: 1000 },
      { code: responderCode, name: "Machu Mech Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 39139935, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [materialCode], extra: [machuCode] }, 1: { main: [targetCode, responderCode] } });
    startDuel(session);

    const machu = requireCard(session, machuCode);
    const material = requireCard(session, materialCode);
    const target = requireCard(session, targetCode);
    const responder = requireCard(session, responderCode);
    moveFaceUpAttack(session, machu, 0);
    machu.summonType = "xyz";
    moveDuelCard(session.state, material.uid, "overlay", 0, duelReason.material | duelReason.xyz, 0);
    machu.overlayUids.push(material.uid);
    moveFaceUpAttack(session, target, 1);
    target.attackModifier = -700;
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
    expect(host.loadCardScript(Number(machuCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    expect(currentAttack(restoredOpen.session.state.cards.find((card) => card.uid === target.uid), restoredOpen.session.state)).toBe(1300);
    const ignition = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === machu.uid);
    expect(ignition, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredAction(restoredOpen, ignition!);

    expect(restoredOpen.session.state.cards.find((card) => card.uid === material.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: machu.uid,
      reasonEffectId: 2,
    });
    expect(restoredOpen.session.state.chain).toEqual([
      {
        id: "chain-3",
        chainIndex: 1,
        effectId: "lua-2",
        sourceUid: machu.uid,
        player: 0,
        activationLocation: "monsterZone",
        activationSequence: 0,
        targetUids: [target.uid],
        operationInfos: [{ category: 0x80000, targetUids: [], count: 0, player: 1, parameter: 700 }],
      },
    ]);
    expect(restoredOpen.session.state.eventHistory.filter((event) => event.eventName === "detachedMaterial")).toEqual([
      {
        eventName: "detachedMaterial",
        eventCode: 1202,
        eventCardUid: material.uid,
        eventReason: duelReason.cost,
        eventReasonPlayer: 0,
        eventReasonCardUid: machu.uid,
        eventReasonEffectId: 2,
        eventPreviousState: { controller: 0, faceUp: false, location: "overlay", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
      },
    ]);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, 1);
    expect(getLuaRestoreLegalActions(restoredChain, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);
    const pass = getLuaRestoreLegalActions(restoredChain, 1).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restoredChain, 1), null, 2)).toBeDefined();
    applyRestoredAction(restoredChain, pass!);

    expect(restoredChain.host.messages).not.toContain("machu mech responder resolved");
    expect(restoredChain.session.state.players[1].lifePoints).toBe(7300);
    expect(currentAttack(restoredChain.session.state.cards.find((card) => card.uid === machu.uid), restoredChain.session.state)).toBe(3100);
    expect(currentAttack(restoredChain.session.state.cards.find((card) => card.uid === target.uid), restoredChain.session.state)).toBe(1300);
    expect(restoredChain.session.state.eventHistory.filter((event) => event.eventName === "damageDealt")).toEqual([
      {
        eventName: "damageDealt",
        eventCode: 1111,
        eventPlayer: 1,
        eventValue: 700,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: machu.uid,
        eventReasonEffectId: 2,
      },
    ]);
    expect(restoredChain.session.state.effects.filter((effect) => effect.sourceUid === machu.uid && effect.code === 100).map((effect) => ({
      code: effect.code,
      event: effect.event,
      value: effect.value,
      reset: effect.reset,
    }))).toEqual([{ code: 100, event: "continuous", value: 700, reset: { flags: 33492992 } }]);
  });
});

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, controller: PlayerId): void {
  moveDuelCard(session.state, card.uid, "monsterZone", controller);
  card.position = "faceUpAttack";
  card.faceUp = true;
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
      e:SetOperation(function(e,tp) Debug.Message("machu mech responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
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

function applyRestoredAction(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = response.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}
