import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { isCardDisabled } from "#duel/continuous-effects.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { createEffectContext } from "#duel/effect-context.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const roarCode = "10793085";
const linkCode = "107930850";
const monsterCostCode = "107930851";
const spellCostCode = "107930852";
const trapCostCode = "107930853";
const statTargetCode = "107930854";
const disableTargetCode = "107930855";
const handTargetCode = "107930856";
const responderCode = "107930857";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasRoarScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${roarCode}.lua`));
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeTrap = 0x4;
const typeEffect = 0x20;
const typeLink = 0x4000000;
const setTriBrigade = 0x14f;

describe.skipIf(!hasUpstreamScripts || !hasRoarScript)("Lua real script Tri-Brigade Roar cost branches", () => {
  it("restores Monster cost branch into targeted final ATK zero", () => {
    const { workspace, source } = sourceWithWorkspace();
    const script = workspace.readScript(`official/c${roarCode}.lua`);
    expect(script).toContain("return Duel.IsExistingMatchingCard(aux.FaceupFilter(Card.IsType,TYPE_LINK)");
    expect(script).toContain("Duel.SelectMatchingCard(tp,s.costfilter,tp,LOCATION_DECK|LOCATION_EXTRA,0,1,1,nil,op1,op2,op3)");
    expect(script).toContain("e:SetLabel(1)");
    expect(script).toContain("e:SetCategory(CATEGORY_ATKCHANGE)");
    expect(script).toContain("e:SetLabel(2)");
    expect(script).toContain("e:SetCategory(CATEGORY_DISABLE)");
    expect(script).toContain("e:SetLabel(3)");
    expect(script).toContain("e:SetCategory(CATEGORY_TOHAND)");
    expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK_FINAL)");
    expect(script).toContain("e1:SetValue(0)");
    expect(script).toContain("Duel.SendtoHand(tc,nil,REASON_EFFECT)");

    const reader = createCardReader(roarCards());
    const session = createBranchSession(reader, [monsterCostCode], statTargetCode);
    const roar = requireCard(session, roarCode);
    const cost = requireCard(session, monsterCostCode);
    const target = requireCard(session, linkCode);
    registerRoar(session, workspace, source);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    activateRoar(restoredOpen, roar.uid);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === cost.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: roar.uid,
      reasonEffectId: 1,
    });
    expect(restoredOpen.session.state.chain[0]).toEqual({
      id: "chain-3",
      chainIndex: 1,
      sourceUid: roar.uid,
      effectId: "lua-1-1002",
      player: 0,
      activationLocation: "spellTrapZone",
      activationSequence: 0,
      targetFieldIds: [7],
      targetUids: [target.uid],
      operationInfos: [{ category: 0x200000, count: 1, parameter: -1000, player: 0, targetUids: [target.uid] }],
      effectLabel: 1,
    });

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, 1);
    resolveRestoredChain(restoredChain);
    expect(currentAttack(requireCard(restoredChain.session, linkCode), restoredChain.session.state)).toBe(0);
    expect(restoredChain.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
    expect(restoredChain.session.state.effects.filter((effect) => effect.sourceUid === target.uid && effect.code === 102).map((effect) => ({
      code: effect.code,
      property: effect.property,
      reset: effect.reset,
      value: effect.value,
    }))).toEqual([{ code: 102, property: undefined, reset: { flags: 1107169792 }, value: 0 }]);
  });

  it("restores Spell cost branch into targeted disable", () => {
    const { workspace, source } = sourceWithWorkspace();
    const reader = createCardReader(roarCards());
    const session = createBranchSession(reader, [spellCostCode], disableTargetCode);
    const roar = requireCard(session, roarCode);
    const cost = requireCard(session, spellCostCode);
    const target = requireCard(session, linkCode);
    registerRoar(session, workspace, source);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    activateRoar(restoredOpen, roar.uid);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === cost.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: roar.uid,
      reasonEffectId: 1,
    });
    expect(restoredOpen.session.state.chain[0]).toEqual({
      id: "chain-3",
      chainIndex: 1,
      sourceUid: roar.uid,
      effectId: "lua-1-1002",
      player: 0,
      activationLocation: "spellTrapZone",
      activationSequence: 0,
      targetFieldIds: [7],
      targetUids: [target.uid],
      operationInfos: [{ category: 0x4000, count: 1, parameter: 0, player: 0, targetUids: [target.uid] }],
      effectLabel: 2,
    });

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, 1);
    resolveRestoredChain(restoredChain);
    const disabledTarget = requireCard(restoredChain.session, linkCode);
    expect(isCardDisabled(restoredChain.session.state, disabledTarget, (effect, sourceCard, targetCard) =>
      createEffectContext(restoredChain.session.state, sourceCard, effect.controller, undefined, targetCard, [], true),
    )).toBe(true);
    expect(restoredChain.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
    expect(restoredChain.session.state.effects.filter((effect) => effect.sourceUid === target.uid && [2, 8].includes(effect.code ?? -1)).map((effect) => ({
      code: effect.code,
      property: effect.property,
      reset: effect.reset,
      value: effect.value,
    }))).toEqual([
      { code: 2, property: undefined, reset: { flags: 1107169792 }, value: undefined },
      { code: 8, property: undefined, reset: { flags: 1107169792 }, value: 131072 },
    ]);
  });

  it("restores Trap cost branch into targeted return to hand", () => {
    const { workspace, source } = sourceWithWorkspace();
    const reader = createCardReader(roarCards());
    const session = createBranchSession(reader, [trapCostCode], handTargetCode);
    const roar = requireCard(session, roarCode);
    const cost = requireCard(session, trapCostCode);
    const target = requireCard(session, linkCode);
    registerRoar(session, workspace, source);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    activateRoar(restoredOpen, roar.uid);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === cost.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: roar.uid,
      reasonEffectId: 1,
    });
    expect(restoredOpen.session.state.chain[0]).toEqual({
      id: "chain-3",
      chainIndex: 1,
      sourceUid: roar.uid,
      effectId: "lua-1-1002",
      player: 0,
      activationLocation: "spellTrapZone",
      activationSequence: 0,
      targetFieldIds: [7],
      targetUids: [target.uid],
      operationInfos: [{ category: 0x8, count: 1, parameter: 0, player: 0, targetUids: [target.uid] }],
      effectLabel: 3,
    });

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, 1);
    resolveRestoredChain(restoredChain);
    expect(restoredChain.session.state.cards.find((card) => card.uid === target.uid)).toMatchObject({
      location: "hand",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: roar.uid,
      reasonEffectId: 1,
    });
    expect(restoredChain.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function sourceWithWorkspace() {
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

function roarCards(): DuelCardData[] {
  return [
    { code: roarCode, name: "Tri-Brigade Roar", kind: "trap", typeFlags: typeTrap },
    { code: linkCode, name: "Tri-Brigade Link Gate", kind: "extra", typeFlags: typeMonster | typeEffect | typeLink, level: 2, attack: 1000, defense: -2, setcodes: [setTriBrigade] },
    { code: monsterCostCode, name: "Tri-Brigade Monster Cost", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1600, defense: 1200, setcodes: [setTriBrigade] },
    { code: spellCostCode, name: "Tri-Brigade Spell Cost", kind: "spell", typeFlags: typeSpell, setcodes: [setTriBrigade] },
    { code: trapCostCode, name: "Tri-Brigade Trap Cost", kind: "trap", typeFlags: typeTrap, setcodes: [setTriBrigade] },
    { code: statTargetCode, name: "Tri-Brigade Roar ATK Target", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 2400, defense: 1000 },
    { code: disableTargetCode, name: "Tri-Brigade Roar Disable Target", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1800, defense: 1200 },
    { code: handTargetCode, name: "Tri-Brigade Roar Hand Target", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1700, defense: 1400 },
    { code: responderCode, name: "Tri-Brigade Roar Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
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
      e:SetOperation(function(e,tp) Debug.Message("tri-brigade roar responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function createBranchSession(reader: ReturnType<typeof createCardReader>, costCodes: string[], targetCode: string): DuelSession {
  const session = createDuel({ seed: Number(targetCode), startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [roarCode, ...costCodes], extra: [linkCode] }, 1: { main: [targetCode, responderCode] } });
  startDuel(session);
  const roar = requireCard(session, roarCode);
  const link = requireCard(session, linkCode);
  const target = requireCard(session, targetCode, 1);
  const responder = requireCard(session, responderCode, 1);
  const setTrap = moveDuelCard(session.state, roar.uid, "spellTrapZone", 0);
  setTrap.position = "faceDown";
  setTrap.faceUp = false;
  moveFaceUpAttack(session, link, 0, 0);
  moveFaceUpAttack(session, target, 1, 0);
  moveDuelCard(session.state, responder.uid, "hand", 1);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  return session;
}

function registerRoar(session: DuelSession, workspace: ReturnType<typeof createUpstreamNodeWorkspace>, source: { readScript(name: string): string }): void {
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(roarCode), source).ok).toBe(true);
  expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(2);
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

function activateRoar(restored: ReturnType<typeof restoreDuelWithLuaScripts>, uid: string): void {
  const action = getLuaRestoreLegalActions(restored, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === uid);
  expect(action, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
  applyRestoredActionAndAssert(restored, action!);
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
