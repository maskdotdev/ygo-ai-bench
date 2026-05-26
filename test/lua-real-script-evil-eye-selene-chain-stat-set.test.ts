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
const seleneCode = "44133040";
const evilEyeMonsterCode = "441330400";
const graveCostCode = "441330401";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasSeleneScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${seleneCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeSpell = 0x2;
const typeEquip = 0x40000;
const setEvilEye = 0x129;
const raceFiend = 0x8;
const attributeDark = 0x20;

describe.skipIf(!hasUpstreamScripts || !hasSeleneScript)("Lua real script Evil Eye of Selene chain stat set", () => {
  it("restores Equip Spell target protections and EVENT_CHAINING ATK/LP drain", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${seleneCode}.lua`));
    const reader = createCardReader(cards());
    const source = scriptSource(workspace);
    const session = createSeleneSession(reader, source, workspace);
    const selene = requireCard(session, seleneCode);
    const target = requireCard(session, evilEyeMonsterCode);
    moveDuelCard(session.state, selene.uid, "hand", 0);
    moveFaceUpAttack(session, target, 0);

    const restoredEquip = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredEquip);
    expectRestoredLegalActions(restoredEquip, 0);
    const equip = getLuaRestoreLegalActions(restoredEquip, 0).find((action) => action.type === "activateEffect" && action.uid === selene.uid);
    expect(equip, JSON.stringify(getLuaRestoreLegalActions(restoredEquip, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredEquip, equip!);
    resolveRestoredChain(restoredEquip);
    expect(restoredEquip.session.state.cards.find((card) => card.uid === selene.uid)).toMatchObject({ location: "spellTrapZone", equippedToUid: target.uid, faceUp: true });
    expect(restoredEquip.session.state.effects.filter((effect) => effect.sourceUid === selene.uid && [41, 42, 71].includes(effect.code ?? -1)).map((effect) => ({
      code: effect.code,
      property: effect.property,
      range: effect.range,
      value: effect.value,
    }))).toEqual([
      { code: 42, property: undefined, range: ["spellTrapZone"], value: 1 },
      { code: 71, property: 0x80, range: ["spellTrapZone"], value: undefined },
      { code: 41, property: undefined, range: ["spellTrapZone"], value: undefined },
    ]);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(restoredEquip.session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const targetEffect = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === target.uid);
    expect(targetEffect, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, targetEffect!);
    expectRestoredLegalActions(restoredOpen, 0);
    const seleneTrigger = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateTrigger" && action.uid === selene.uid);
    expect(seleneTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, seleneTrigger!);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, restoredChain.session.state.waitingFor ?? 0);
    resolveRestoredChain(restoredChain);
    expect(currentAttack(restoredChain.session.state.cards.find((card) => card.uid === target.uid), restoredChain.session.state)).toBe(2000);
    expect(restoredChain.session.state.players[0].lifePoints).toBe(7500);
    expect(restoredChain.session.state.cards.find((card) => card.uid === target.uid)).toMatchObject({ attackModifier: 500 });
    expect(restoredChain.session.state.eventHistory.filter((event) => event.eventName === "lifePointCostPaid")).toEqual([]);
    expect(restoredChain.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });

  it("restores Graveyard LP/banish cost into self-Set", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${seleneCode}.lua`));
    const reader = createCardReader(cards());
    const source = scriptSource(workspace);
    const session = createSeleneSession(reader, source, workspace);
    const selene = requireCard(session, seleneCode);
    const cost = requireCard(session, graveCostCode);
    moveDuelCard(session.state, selene.uid, "graveyard", 0);
    moveDuelCard(session.state, cost.uid, "graveyard", 0);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const setAction = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === selene.uid);
    expect(setAction, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, setAction!);

    expect(restoredOpen.session.state.players[0].lifePoints).toBe(7000);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === cost.uid)).toMatchObject({ location: "banished", reason: duelReason.cost });
    expect(restoredOpen.session.state.cards.find((card) => card.uid === selene.uid)).toMatchObject({ location: "spellTrapZone", faceUp: false, position: "faceDown" });
    expect(restoredOpen.session.state.eventHistory.filter((event) => ["banished", "lifePointCostPaid", "spellTrapSet"].includes(event.eventName))).toEqual([
      {
        eventName: "banished",
        eventCode: 1011,
        eventCardUid: cost.uid,
        eventReason: duelReason.cost,
        eventReasonPlayer: 0,
        eventReasonCardUid: selene.uid,
        eventReasonEffectId: 7,
        eventPreviousState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 1 },
        eventCurrentState: { controller: 0, faceUp: true, location: "banished", position: "faceDown", sequence: 0 },
      },
      {
        eventName: "lifePointCostPaid",
        eventCode: 1201,
        eventPlayer: 0,
        eventValue: 1000,
        eventReason: duelReason.cost,
        eventReasonPlayer: 0,
        eventReasonCardUid: selene.uid,
        eventReasonEffectId: 7,
      },
      {
        eventName: "spellTrapSet",
        eventCode: 1107,
        eventCardUid: selene.uid,
        eventReason: duelReason.rule,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: false, location: "spellTrapZone", position: "faceDown", sequence: 0 },
      },
    ]);
    expect(restoredOpen.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("aux.AddEquipProcedure(c,nil,aux.FilterBoolFunction(Card.IsSetCard,SET_EVIL_EYE))");
  expect(script).toContain("e2:SetCode(EFFECT_CANNOT_BE_EFFECT_TARGET)");
  expect(script).toContain("e2:SetProperty(EFFECT_FLAG_IGNORE_IMMUNE)");
  expect(script).toContain("e2:SetValue(aux.tgoval)");
  expect(script).toContain("e3:SetCode(EFFECT_INDESTRUCTABLE_EFFECT)");
  expect(script).toContain("e3:SetValue(aux.indoval)");
  expect(script).toContain("e5:SetCode(EVENT_CHAINING)");
  expect(script).toContain("ec:UpdateAttack(500,nil,c)==500");
  expect(script).toContain("Duel.SetLP(tp,Duel.GetLP(tp)-500)");
  expect(script).toContain("Duel.CheckLPCost(tp,1000)");
  expect(script).toContain("Duel.Remove(g,POS_FACEUP,REASON_COST)");
  expect(script).toContain("Duel.PayLPCost(tp,1000)");
  expect(script).toContain("Duel.SSet(tp,c)");
}

function cards(): DuelCardData[] {
  return [
    { code: seleneCode, name: "Evil Eye of Selene", kind: "spell", typeFlags: typeSpell | typeEquip, setcodes: [setEvilEye] },
    { code: evilEyeMonsterCode, name: "Evil Eye Fixture Monster", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setEvilEye], race: raceFiend, attribute: attributeDark, level: 4, attack: 1500, defense: 1000 },
    { code: graveCostCode, name: "Evil Eye Grave Cost", kind: "spell", typeFlags: typeSpell, setcodes: [setEvilEye] },
  ];
}

function scriptSource(workspace: ReturnType<typeof createUpstreamNodeWorkspace>) {
  return {
    readScript(name: string) {
      if (name === `c${evilEyeMonsterCode}.lua`) return evilEyeMonsterScript();
      return workspace.readScript(name);
    },
  };
}

function evilEyeMonsterScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_IGNITION)
      e:SetRange(LOCATION_MZONE)
      e:SetOperation(function() Debug.Message("evil eye target effect resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function createSeleneSession(reader: ReturnType<typeof createCardReader>, source: ReturnType<typeof scriptSource>, workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelSession {
  const session = createDuel({ seed: 44133040, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [seleneCode, evilEyeMonsterCode, graveCostCode] }, 1: { main: [] } });
  startDuel(session);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(seleneCode), source).ok).toBe(true);
  expect(host.loadCardScript(Number(evilEyeMonsterCode), source).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(2);
  return session;
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
