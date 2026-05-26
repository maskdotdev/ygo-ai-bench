import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const fortissimoCode = "11493868";
const hasFortissimoScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${fortissimoCode}.lua`));
const targetCode = "114938680";
const responderCode = "114938681";
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeEffect = 0x20;
const typeField = 0x20000;
const raceFairy = 0x4;
const raceWarrior = 0x1;
const attributeLight = 0x10;
const attributeEarth = 0x1;
const setMelodious = 0x9b;

describe.skipIf(!hasUpstreamScripts || !hasFortissimoScript)("Lua real script Fortissimo target Melodious stat", () => {
  it("restores targeted Melodious ignition ATK boost from the field Spell", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${fortissimoCode}.lua`);
    expect(script).toContain("aux.FilterBoolFunction(Card.IsSetCard,SET_MELODIOUS),Fusion.OnFieldMat");
    expect(script).toContain("e2:SetCategory(CATEGORY_ATKCHANGE)");
    expect(script).toContain("e2:SetProperty(EFFECT_FLAG_CARD_TARGET)");
    expect(script).toContain("Duel.SelectTarget(tp,s.atkfilter,tp,LOCATION_MZONE,0,1,1,nil)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_ATKCHANGE,g,1,0,800)");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e1:SetReset(RESET_EVENT|RESETS_STANDARD|RESET_PHASE|PHASE_STANDBY|RESET_SELF_TURN)");
    expect(script).toContain("e1:SetValue(800)");
    expect(script).toContain("e3:SetCost(Cost.SelfToGrave)");
    expect(script).toContain("Fusion.SummonEffTG(table.unpack(params))");

    const reader = createCardReader(cards());
    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return responderScript();
        return workspace.readScript(name);
      },
    };
    const session = createDuel({ seed: 11493868, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [fortissimoCode, targetCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const fortissimo = requireCard(session, fortissimoCode);
    const target = requireCard(session, targetCode);
    const responder = requireCard(session, responderCode);
    moveFaceUpSpellTrap(session, fortissimo, 0, 0);
    moveFaceUpAttack(session, target, 0, 0);
    moveDuelCard(session.state, responder.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    for (const code of [fortissimoCode, responderCode]) expect(host.loadCardScript(Number(code), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const boost = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === fortissimo.uid && action.effectId === "lua-2");
    expect(boost, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, boost!);
    expect(restoredOpen.session.state.chain).toEqual([
      {
        id: "chain-2",
        chainIndex: 1,
        effectId: "lua-2",
        sourceUid: fortissimo.uid,
        player: 0,
        activationLocation: "spellTrapZone",
        activationSequence: 0,
        targetFieldIds: [5],
        targetUids: [target.uid],
        operationInfos: [{ category: 0x200000, targetUids: [target.uid], count: 1, player: 0, parameter: 800 }],
      },
    ]);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, 1);
    expect(getLuaRestoreLegalActions(restoredChain, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);
    resolveRestoredChain(restoredChain);

    expect(restoredChain.host.messages).not.toContain("fortissimo responder resolved");
    expect(currentAttack(restoredChain.session.state.cards.find((card) => card.uid === target.uid), restoredChain.session.state)).toBe(2600);
    expect(restoredChain.session.state.effects.filter((effect) => effect.sourceUid === target.uid && effect.code === 100).map((effect) => ({
      code: effect.code,
      event: effect.event,
      property: effect.property,
      reset: effect.reset,
      value: effect.value,
    }))).toEqual([{ code: 100, event: "continuous", property: undefined, reset: { flags: 1375604738 }, value: 800 }]);
    expect(restoredChain.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });

    const restoredStat = restoreDuelWithLuaScripts(serializeDuel(restoredChain.session), source, reader);
    expectCleanRestore(restoredStat);
    expectRestoredLegalActions(restoredStat, 1);
    expect(currentAttack(restoredStat.session.state.cards.find((card) => card.uid === target.uid), restoredStat.session.state)).toBe(2600);
  });
});

function cards(): DuelCardData[] {
  return [
    { code: fortissimoCode, name: "Fortissimo", kind: "spell", typeFlags: typeSpell | typeField },
    { code: targetCode, name: "Fortissimo Melodious Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFairy, attribute: attributeLight, level: 4, attack: 1800, defense: 1000, setcodes: [setMelodious] },
    { code: responderCode, name: "Fortissimo Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1000, defense: 1000 },
  ];
}

function responderScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_QUICK_O)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetRange(LOCATION_HAND)
      e:SetCondition(function(e,tp) return Duel.GetCurrentChain()>0 end)
      e:SetOperation(function(e,tp) Debug.Message("fortissimo responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  moved.sequence = sequence;
}

function moveFaceUpSpellTrap(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): void {
  const moved = moveDuelCard(session.state, card.uid, "spellTrapZone", player);
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
