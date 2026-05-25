import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const adminiaCode = "61470213";
const costCode = "614702130";
const trapCode = "614702131";
const targetCode = "614702132";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasAdminiaScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${adminiaCode}.lua`));
const typeMonster = 0x1;
const typeTrap = 0x4;
const typeEffect = 0x20;
const typeLink = 0x4000000;
const raceSpellcaster = 0x10;
const raceWarrior = 0x1;
const attributeDark = 0x20;
const setAltergeist = 0x103;
const categorySet = 0x100000000;
const categoryControl = 0x2000;
const effectFlagCardTarget = 0x10;
const effectFlagNoTurnReset = 0x400000;
const effectFlagDelay = 0x10000;
const eventFreeChain = 1002;
const eventSpecialSummonSuccess = 1102;
const effectAddSetcode = 334;

describe.skipIf(!hasUpstreamScripts || !hasAdminiaScript)("Lua real script Altergeist Adminia cost control setcode", () => {
  it("restores quick cost target control into temporary Altergeist setcode", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${adminiaCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards());
    const session = createDuel({ seed: 61470213, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [costCode, trapCode], extra: [adminiaCode] }, 1: { main: [targetCode] } });
    startDuel(session);
    const adminia = moveFaceUpAttack(session, requireCard(session, adminiaCode), 0);
    adminia.summonType = "link";
    adminia.summonTypeCode = 0x4c000000;
    const cost = moveDuelCard(session.state, requireCard(session, costCode).uid, "spellTrapZone", 0);
    cost.faceUp = true;
    const target = moveFaceUpAttack(session, requireCard(session, targetCode), 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(adminiaCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restored);
    expect(restored.session.state.effects.filter((effect) => effect.sourceUid === adminia.uid && (effect.event === "trigger" || effect.event === "quick")).map((effect) => ({
      category: effect.category,
      code: effect.code,
      countLimit: effect.countLimit,
      event: effect.event,
      property: effect.property,
      range: effect.range,
      triggerEvent: effect.triggerEvent,
    }))).toEqual([
      { category: categorySet, code: eventSpecialSummonSuccess, countLimit: 1, event: "trigger", property: effectFlagDelay, range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"], triggerEvent: "specialSummoned" },
      { category: categoryControl, code: eventFreeChain, countLimit: 1, event: "quick", property: effectFlagCardTarget | effectFlagNoTurnReset, range: ["monsterZone"], triggerEvent: undefined },
    ]);
    expectRestoredLegalActions(restored, 0);
    const control = getLuaRestoreLegalActions(restored, 0).find((action) =>
      action.type === "activateEffect" && action.uid === adminia.uid && action.effectId === "lua-3-1002"
    );
    expect(control, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, control!);
    resolveRestoredChain(restored);

    expect(restored.session.state.cards.find((card) => card.uid === cost.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: adminia.uid,
      reasonEffectId: 3,
    });
    expect(restored.session.state.cards.find((card) => card.uid === target.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      previousController: 1,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: adminia.uid,
      reasonEffectId: 3,
    });
    expect(restored.session.state.effects.find((effect) =>
      effect.sourceUid === target.uid && effect.code === effectAddSetcode
    )).toMatchObject({
      code: effectAddSetcode,
      event: "continuous",
      range: ["monsterZone"],
      value: setAltergeist,
    });
    expect(restored.session.state.cards.find((card) => card.uid === requireCard(restored.session, trapCode).uid)).toMatchObject({
      location: "deck",
      controller: 0,
    });
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Altergeist Adminia");
  expect(script).toContain("Link.AddProcedure(c,aux.FilterBoolFunctionEx(Card.IsSetCard,SET_ALTERGEIST),2)");
  expect(script).toContain("e1:SetCategory(CATEGORY_SET)");
  expect(script).toContain("e1:SetCode(EVENT_SPSUMMON_SUCCESS)");
  expect(script).toContain("return e:GetHandler():IsLinkSummoned()");
  expect(script).toContain("Duel.SelectMatchingCard(tp,s.setfilter,tp,LOCATION_DECK,0,1,1,nil)");
  expect(script).toContain("Duel.SSet(tp,g)");
  expect(script).toContain("e2:SetCategory(CATEGORY_CONTROL)");
  expect(script).toContain("e2:SetType(EFFECT_TYPE_QUICK_O)");
  expect(script).toContain("e2:SetProperty(EFFECT_FLAG_CARD_TARGET+EFFECT_FLAG_NO_TURN_RESET)");
  expect(script).toContain("Duel.SelectMatchingCard(tp,s.cstfilter,tp,LOCATION_ONFIELD,0,1,1,nil)");
  expect(script).toContain("Duel.SendtoGrave(g,REASON_COST)");
  expect(script).toContain("Duel.SelectTarget(tp,s.ctfilter,tp,0,LOCATION_MZONE,1,1,nil)");
  expect(script).toContain("Duel.GetControl(tc,tp)");
  expect(script).toContain("e1:SetCode(EFFECT_ADD_SETCODE)");
  expect(script).toContain("e1:SetValue(SET_ALTERGEIST)");
}

function cards(): DuelCardData[] {
  return [
    { code: adminiaCode, name: "Altergeist Adminia", kind: "monster", typeFlags: typeMonster | typeEffect | typeLink, race: raceSpellcaster, attribute: attributeDark, setcodes: [setAltergeist], level: 2, attack: 3000, defense: 0, linkMarkers: 0x28 },
    { code: costCode, name: "Adminia Cost", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceSpellcaster, attribute: attributeDark, setcodes: [setAltergeist], level: 4, attack: 1000, defense: 1000 },
    { code: trapCode, name: "Altergeist Trap", kind: "trap", typeFlags: typeTrap, setcodes: [setAltergeist] },
    { code: targetCode, name: "Adminia Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeDark, level: 4, attack: 1800, defense: 1000 },
  ];
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  return moved;
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
