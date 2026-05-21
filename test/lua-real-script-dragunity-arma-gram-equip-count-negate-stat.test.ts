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
const gramCode = "53184342";
const equipCode = "531843420";
const targetCode = "531843421";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasGramScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${gramCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeSpell = 0x2;
const typeEquip = 0x40000;
const raceDragon = 0x2000;
const raceWingedBeast = 0x80;

describe.skipIf(!hasUpstreamScripts || !hasGramScript)("Lua real script Dragunity Arma Gram equip-count negate stat", () => {
  it("restores target negation with face-up Equip count ATK loss while pinning summon and battle-equip branches", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${gramCode}.lua`);
    expectScriptShape(script);

    const reader = createCardReader(cards());
    const session = createDuel({ seed: 53184342, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [gramCode, equipCode] }, 1: { main: [targetCode] } });
    startDuel(session);

    const gram = requireCard(session, gramCode);
    const equip = requireCard(session, equipCode);
    const target = requireCard(session, targetCode);
    moveFaceUpAttack(session, gram, 0);
    moveFaceUpEquip(session, equip, gram.uid);
    moveFaceUpAttack(session, target, 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(gramCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === gram.uid).map((effect) => ({
      code: effect.code,
      event: effect.event,
      range: effect.range,
      value: effect.value,
    }))).toEqual([
      { code: undefined, event: "ignition", range: ["hand", "graveyard"], value: undefined },
      { code: undefined, event: "ignition", range: ["monsterZone"], value: undefined },
      { code: 1140, event: "trigger", range: ["monsterZone"], value: undefined },
      { code: 89785779, event: "continuous", range: ["monsterZone"], value: undefined },
      { code: 89785855, event: "continuous", range: ["monsterZone"], value: undefined },
    ]);
    const negate = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === gram.uid && action.effectId === "lua-2");
    expect(negate, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, negate!);
    expect(restoredOpen.session.state.chain.flatMap((link) => link.operationInfos ?? [])).toEqual([]);
    passRestoredChain(restoredOpen);

    expect(currentAttack(restoredOpen.session.state.cards.find((card) => card.uid === gram.uid), restoredOpen.session.state)).toBe(1900);
    expect(currentAttack(restoredOpen.session.state.cards.find((card) => card.uid === target.uid), restoredOpen.session.state)).toBe(2400);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === gram.uid && [6, 7, 100].includes(effect.code ?? -1)).map((effect) => ({
      code: effect.code,
      property: effect.property,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: 100, property: 0x400, reset: { flags: 33427456 }, sourceUid: gram.uid, value: -1000 },
    ]);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === equip.uid)).toMatchObject({
      location: "spellTrapZone",
      controller: 0,
      faceUp: true,
      equippedToUid: gram.uid,
    });
    expect(restoredOpen.session.state.eventHistory.filter((event) => ["destroyed", "sentToGraveyard"].includes(event.eventName))).toEqual([]);
    expect(restoredOpen.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("e1:SetRange(LOCATION_HAND|LOCATION_GRAVE)");
  expect(script).toContain("e1:SetCost(s.spcost)");
  expect(script).toContain("aux.SelectUnselectGroup(rg,e,tp,2,2,aux.ChkfMMZ(1),1,tp,HINTMSG_REMOVE)");
  expect(script).toContain("Duel.Remove(g,POS_FACEUP,REASON_COST)");
  expect(script).toContain("Duel.SpecialSummon(c,0,tp,tp,false,false,POS_FACEUP)");
  expect(script).toContain("e2:SetCategory(CATEGORY_DISABLE+CATEGORY_ATKCHANGE)");
  expect(script).toContain("e2:SetProperty(EFFECT_FLAG_CARD_TARGET)");
  expect(script).toContain("Duel.SelectTarget(tp,s.distg,tp,LOCATION_MZONE,LOCATION_MZONE,1,1,nil,eqpc)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_DISABLE,g,1,0,0)");
  expect(script).toContain("tc:IsCanBeDisabledByEffect(e)");
  expect(script).toContain("e1:SetCode(EFFECT_DISABLE)");
  expect(script).toContain("e2:SetCode(EFFECT_DISABLE_EFFECT)");
  expect(script).toContain("Duel.GetMatchingGroupCount(aux.FaceupFilter(Card.IsType,TYPE_EQUIP),tp,LOCATION_SZONE,0,nil)");
  expect(script).toContain("e3:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e3:SetValue(-ct*1000)");
  expect(script).toContain("e3:SetCode(EVENT_BATTLE_DESTROYED)");
  expect(script).toContain("Duel.SetTargetCard(eqg)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_LEAVE_GRAVE,eqg,1,0,0)");
  expect(script).toContain("Duel.Equip(tp,tc,c,true,true)");
  expect(script).toContain("e1:SetCode(EFFECT_EQUIP_LIMIT)");
  expect(script).toContain("Duel.EquipComplete()");
  expect(script).toContain("aux.AddEREquipLimit(c,nil,aux.FilterBoolFunction(Card.IsMonster),Card.EquipByEffectAndLimitRegister,e3)");
}

function cards(): DuelCardData[] {
  return [
    { code: gramCode, name: "Dragunity Arma Gram", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceDragon, level: 10, attack: 2900, defense: 2200 },
    { code: equipCode, name: "Dragunity Arma Gram Equip Probe", kind: "spell", typeFlags: typeSpell | typeEquip },
    { code: targetCode, name: "Dragunity Arma Gram Negatable Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWingedBeast, level: 4, attack: 2400, defense: 1000 },
  ];
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
}

function moveFaceUpEquip(session: DuelSession, card: DuelCardInstance, equippedToUid: string): void {
  const moved = moveDuelCard(session.state, card.uid, "spellTrapZone", 0);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  moved.equippedToUid = equippedToUid;
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
