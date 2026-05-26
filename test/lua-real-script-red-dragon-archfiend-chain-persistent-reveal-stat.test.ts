import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { isCardDisabled } from "#duel/continuous-effects.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { createEffectContext } from "#duel/effect-context.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const chainCode = "92936364";
const tunerCode = "929363640";
const targetACode = "929363641";
const targetBCode = "929363642";
const responderCode = "929363643";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasChainScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${chainCode}.lua`));
const typeMonster = 0x1;
const typeTrap = 0x4;
const typeTuner = 0x1000;
const typeEffect = 0x20;
const typeContinuous = 0x20000;

describe.skipIf(!hasUpstreamScripts || !hasChainScript)("Lua real script Red Dragon Archfiend's Chain persistent reveal stat", () => {
  it("restores hand reveal cost into two persistent targets, ATK loss, disable, and self-destroy watcher", () => {
    const { workspace, source } = sourceWithResponder();
    const script = workspace.readScript(`official/c${chainCode}.lua`);
    expect(script).toContain("e0:SetCode(EFFECT_TRAP_ACT_IN_SET_TURN)");
    expect(script).toContain("aux.SelectUnselectGroup(hg,e,tp,1,#hg,rescon,1,tp,HINTMSG_CONFIRM,rescon)");
    expect(script).toContain("Duel.ConfirmCards(1-tp,sg)");
    expect(script).toContain("Duel.ShuffleHand(tp)");
    expect(script).toContain("Duel.SelectTarget(tp,aux.FaceupFilter(Card.IsEffectMonster),tp,0,LOCATION_MZONE,target_count,target_count,nil)");
    expect(script).toContain("Duel.GetTargetCards(e):Match(Card.IsFaceup,nil)");
    expect(script).toContain("c:SetCardTarget(tc)");
    expect(script).toContain("e2:SetTarget(aux.PersistentTargetFilter)");
    expect(script).toContain("e2:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e3:SetCode(EFFECT_DISABLE)");
    expect(script).toContain("e1:SetCode(EFFECT_SELF_DESTROY)");

    const reader = createCardReader(chainCards());
    const session = createDuel({ seed: 92936364, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [chainCode, tunerCode] }, 1: { main: [targetACode, targetBCode, responderCode] } });
    startDuel(session);

    const chain = requireCard(session, chainCode);
    const tuner = requireCard(session, tunerCode);
    const targetA = requireCard(session, targetACode, 1);
    const targetB = requireCard(session, targetBCode, 1);
    const responder = requireCard(session, responderCode, 1);
    const setTrap = moveDuelCard(session.state, chain.uid, "spellTrapZone", 0);
    setTrap.position = "faceDown";
    setTrap.faceUp = false;
    moveDuelCard(session.state, tuner.uid, "hand", 0);
    moveFaceUpAttack(session, targetA, 1, 0);
    moveFaceUpAttack(session, targetB, 1, 1);
    moveDuelCard(session.state, responder.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    for (const code of [chainCode, responderCode]) expect(host.loadCardScript(Number(code), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const activation = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === chain.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, activation!);
    expect(restoredOpen.session.state.chain[0]).toEqual({
      id: "chain-2",
      chainIndex: 1,
      sourceUid: chain.uid,
      effectId: "lua-2-1002",
      player: 0,
      activationLocation: "spellTrapZone",
      activationSequence: 0,
      targetFieldIds: [8, 9],
      targetUids: [targetA.uid, targetB.uid],
      operationInfos: [{ category: 0x4000, count: 1, parameter: 0, player: 0, targetUids: [targetA.uid, targetB.uid] }],
      effectLabel: 1,
    });
    expect(restoredOpen.session.state.eventHistory.filter((event) => event.eventName === "confirmed").map((event) => event.eventName)).toEqual(["confirmed"]);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, 1);
    resolveRestoredChain(restoredChain);
    expect(restoredChain.host.messages).not.toContain("red dragon archfiend chain responder resolved");
    expect(restoredChain.session.state.cards.find((card) => card.uid === chain.uid)).toMatchObject({
      location: "spellTrapZone",
      faceUp: true,
      cardTargetUids: [targetA.uid, targetB.uid],
    });
    expectPersistentProbe(restoredChain, "red dragon chain persistent true/true/2/1700/1600/true/true");
    expect(currentAttack(requireCard(restoredChain.session, targetACode, 1), restoredChain.session.state)).toBe(1700);
    expect(currentAttack(requireCard(restoredChain.session, targetBCode, 1), restoredChain.session.state)).toBe(1600);
    for (const target of [targetA, targetB]) {
      const restoredTarget = restoredChain.session.state.cards.find((card) => card.uid === target.uid);
      expect(restoredTarget).toBeDefined();
      expect(isCardDisabled(restoredChain.session.state, restoredTarget!, (effect, sourceCard, targetCard) =>
        createEffectContext(restoredChain.session.state, sourceCard, effect.controller, undefined, targetCard, [], true),
      )).toBe(true);
    }
    expect(restoredChain.session.state.effects.filter((effect) => effect.sourceUid === chain.uid && [2, 100, 141].includes(effect.code ?? -1)).map((effect) => ({
      code: effect.code,
      event: effect.event,
      range: effect.range,
      targetRange: effect.targetRange,
      value: effect.value,
    }))).toEqual([
      { code: 100, event: "continuous", range: ["spellTrapZone"], targetRange: [4, 4], value: undefined },
      { code: 2, event: "continuous", range: ["spellTrapZone"], targetRange: [4, 4], value: undefined },
      { code: 141, event: "continuous", range: ["spellTrapZone"], targetRange: undefined, value: undefined },
    ]);
    expect(restoredChain.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function sourceWithResponder() {
  const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
  return {
    workspace,
    source: {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        const loaded = workspace.readScript(name);
        if (loaded === undefined) throw new Error(`Missing script ${name}`);
        return loaded;
      },
    },
  };
}

function chainCards(): DuelCardData[] {
  return [
    { code: chainCode, name: "Red Dragon Archfiend's Chain", kind: "trap", typeFlags: typeTrap | typeContinuous },
    { code: tunerCode, name: "Red Dragon Chain Revealed Tuner", kind: "monster", typeFlags: typeMonster | typeEffect | typeTuner, level: 4, attack: 1200, defense: 1000 },
    { code: targetACode, name: "Red Dragon Chain Target A", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1800, defense: 1200 },
    { code: targetBCode, name: "Red Dragon Chain Target B", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1700, defense: 1100 },
    { code: responderCode, name: "Red Dragon Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
  ];
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
      e:SetOperation(function(e,tp) Debug.Message("red dragon archfiend chain responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function expectPersistentProbe(restored: ReturnType<typeof restoreDuelWithLuaScripts>, message: string): void {
  const probe = restored.host.loadScript(
    `
      local trap=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${chainCode}),0,LOCATION_SZONE,0,nil)
      local a=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${targetACode}),0,0,LOCATION_MZONE,nil)
      local b=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${targetBCode}),0,0,LOCATION_MZONE,nil)
      local e=Effect.CreateEffect(trap)
      Debug.Message(
        "red dragon chain persistent " ..
        tostring(trap:IsHasCardTarget(a)) .. "/" ..
        tostring(aux.PersistentTargetFilter(e,a)) .. "/" ..
        trap:GetCardTargetCount() .. "/" ..
        a:GetAttack() .. "/" ..
        b:GetAttack() .. "/" ..
        tostring(a:IsDisabled()) .. "/" ..
        tostring(b:IsDisabled())
      )
    `,
    "red-dragon-archfiend-chain-persistent-probe.lua",
  );
  expect(probe.ok, probe.error).toBe(true);
  expect(restored.host.messages).toContain(message);
}

function requireCard(session: DuelSession, code: string, owner = 0): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code && candidate.owner === owner);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  moved.sequence = sequence;
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
