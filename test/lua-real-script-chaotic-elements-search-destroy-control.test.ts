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
const chaoticCode = "92221402";
const searchCode = "922214020";
const gravePyro1Code = "922214021";
const graveAquaCode = "922214022";
const gravePyro2Code = "922214023";
const destroyTargetCode = "922214024";
const controlTargetCode = "922214025";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasChaoticScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${chaoticCode}.lua`));
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeEffect = 0x20;
const raceAqua = 0x40;
const racePyro = 0x80;
const raceWarrior = 0x1;
const attributeLight = 0x10;
const attributeDark = 0x20;
const categoryDestroy = 0x1;
const categoryToHand = 0x8;
const categoryControl = 0x2000;
const categorySearch = 0x20000;
const effectFlagCardTarget = 0x10;
const promptOverrides = [{ api: "SelectYesNo" as const, player: 0 as const, returned: true }];

describe.skipIf(!hasUpstreamScripts || !hasChaoticScript)("Lua real script Chaotic Elements search destroy control", () => {
  it("restores search plus optional destruction and grave SelfBanish temporary control", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${chaoticCode}.lua`));
    const reader = createCardReader(cards());

    const search = createRestoredSearchField({ reader, workspace });
    expect(search.restored.session.state.effects.filter((effect) => effect.sourceUid === search.chaotic.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      countLimit: effect.countLimit,
      event: effect.event,
      property: effect.property,
      range: effect.range,
      sourceUid: effect.sourceUid,
    }))).toEqual([
      { category: categoryToHand | categorySearch | categoryDestroy, code: 1002, countLimit: 1, event: "ignition", property: undefined, range: ["hand", "spellTrapZone"], sourceUid: search.chaotic.uid },
      { category: categoryControl, code: undefined, countLimit: 1, event: "ignition", property: effectFlagCardTarget, range: ["graveyard"], sourceUid: search.chaotic.uid },
    ]);
    const activate = getLuaRestoreLegalActions(search.restored, 0).find((action) =>
      action.type === "activateEffect" && action.uid === search.chaotic.uid && action.effectId === "lua-1-1002"
    );
    expect(activate, JSON.stringify(getLuaRestoreLegalActions(search.restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(search.restored, activate!);
    passRestoredChain(search.restored);

    expect(search.restored.host.promptDecisions).toEqual([
      { id: "lua-prompt-1", api: "SelectYesNo", player: 0, description: 1475542434, returned: true },
    ]);
    expect(findCard(search.restored.session, search.searchTarget.uid)).toMatchObject({
      location: "hand",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: search.chaotic.uid,
      reasonEffectId: 1,
    });
    expect(findCard(search.restored.session, search.destroyTarget.uid)).toMatchObject({
      location: "graveyard",
      controller: 1,
      reason: duelReason.effect | duelReason.destroy,
      reasonPlayer: 0,
      reasonCardUid: search.chaotic.uid,
      reasonEffectId: 1,
    });
    expect(search.restored.host.messages).toContain(`confirmed 1: ${searchCode}`);
    expect(search.restored.session.state.eventHistory.filter((event) => ["sentToHand", "confirmed", "sentToHandConfirmed", "destroyed"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventPlayer: event.eventPlayer,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      previousLocation: event.eventPreviousState?.location,
      currentLocation: event.eventCurrentState?.location,
    }))).toEqual([
      { eventName: "sentToHand", eventCode: 1012, eventCardUid: search.searchTarget.uid, eventPlayer: undefined, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: search.chaotic.uid, eventReasonEffectId: 1, previousLocation: "deck", currentLocation: "hand" },
      { eventName: "confirmed", eventCode: 1211, eventCardUid: search.searchTarget.uid, eventPlayer: 1, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: search.chaotic.uid, eventReasonEffectId: 1, previousLocation: "deck", currentLocation: "hand" },
      { eventName: "sentToHandConfirmed", eventCode: 1212, eventCardUid: search.searchTarget.uid, eventPlayer: 1, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: search.chaotic.uid, eventReasonEffectId: 1, previousLocation: "deck", currentLocation: "hand" },
      { eventName: "destroyed", eventCode: 1029, eventCardUid: search.destroyTarget.uid, eventPlayer: undefined, eventReason: duelReason.effect | duelReason.destroy, eventReasonPlayer: 0, eventReasonCardUid: search.chaotic.uid, eventReasonEffectId: 1, previousLocation: "monsterZone", currentLocation: "graveyard" },
    ]);

    const control = createRestoredControlField({ reader, workspace });
    const controlAction = getLuaRestoreLegalActions(control.restored, 0).find((action) =>
      action.type === "activateEffect" && action.uid === control.chaotic.uid && action.effectId === "lua-2"
    );
    expect(controlAction, JSON.stringify(getLuaRestoreLegalActions(control.restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(control.restored, controlAction!);
    passRestoredChain(control.restored);

    expect(findCard(control.restored.session, control.chaotic.uid)).toMatchObject({
      location: "banished",
      controller: 0,
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: control.chaotic.uid,
      reasonEffectId: 2,
    });
    expect(findCard(control.restored.session, control.controlTarget.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      previousController: 1,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: control.chaotic.uid,
      reasonEffectId: 2,
    });
    expect(control.restored.session.state.eventHistory.filter((event) => ["banished", "controlChanged"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      previousLocation: event.eventPreviousState?.location,
      previousController: event.eventPreviousState?.controller,
      currentLocation: event.eventCurrentState?.location,
      currentController: event.eventCurrentState?.controller,
    }))).toEqual([
      { eventName: "banished", eventCode: 1011, eventCardUid: control.chaotic.uid, eventReason: duelReason.cost, eventReasonPlayer: 0, eventReasonCardUid: control.chaotic.uid, eventReasonEffectId: 2, previousLocation: "graveyard", previousController: 0, currentLocation: "banished", currentController: 0 },
      { eventName: "controlChanged", eventCode: 1120, eventCardUid: control.controlTarget.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: control.chaotic.uid, eventReasonEffectId: 2, previousLocation: "monsterZone", previousController: 1, currentLocation: "monsterZone", currentController: 0 },
    ]);
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Chaotic Elements");
  expect(script).toContain("e1:SetCategory(CATEGORY_TOHAND+CATEGORY_SEARCH+CATEGORY_DESTROY)");
  expect(script).toContain("e1:SetType(EFFECT_TYPE_ACTIVATE)");
  expect(script).toContain("Duel.SetPossibleOperationInfo(0,CATEGORY_DESTROY,nil,1,PLAYER_EITHER,LOCATION_ONFIELD)");
  expect(script).toContain("Duel.SelectMatchingCard(tp,aux.NecroValleyFilter(s.thfilter),tp,LOCATION_DECK|LOCATION_GRAVE,0,1,1,nil)");
  expect(script).toContain("Duel.ConfirmCards(1-tp,tc)");
  expect(script).toContain("Duel.SelectYesNo(tp,aux.Stringid(id,2))");
  expect(script).toContain("Duel.Destroy(sg,REASON_EFFECT)");
  expect(script).toContain("e2:SetCategory(CATEGORY_CONTROL)");
  expect(script).toContain("e2:SetProperty(EFFECT_FLAG_CARD_TARGET)");
  expect(script).toContain("e2:SetRange(LOCATION_GRAVE)");
  expect(script).toContain("e2:SetCost(Cost.SelfBanish)");
  expect(script).toContain("Duel.SelectTarget(tp,Card.IsControlerCanBeChanged,tp,0,LOCATION_MZONE,1,1,nil)");
  expect(script).toContain("Duel.GetControl(tc,tp,PHASE_END,1)");
}

function createRestoredSearchField({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}) {
  const session = createDuel({ seed: 92221402, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [chaoticCode, searchCode, gravePyro1Code, graveAquaCode, gravePyro2Code] }, 1: { main: [destroyTargetCode] } });
  startDuel(session);
  const chaotic = requireCard(session, chaoticCode);
  const searchTarget = requireCard(session, searchCode);
  const gravePyro1 = requireCard(session, gravePyro1Code);
  const graveAqua = requireCard(session, graveAquaCode);
  const gravePyro2 = requireCard(session, gravePyro2Code);
  const destroyTarget = requireCard(session, destroyTargetCode);
  moveDuelCard(session.state, chaotic.uid, "hand", 0);
  moveDuelCard(session.state, gravePyro1.uid, "graveyard", 0);
  moveDuelCard(session.state, graveAqua.uid, "graveyard", 0);
  moveDuelCard(session.state, gravePyro2.uid, "graveyard", 0);
  moveFaceUpAttack(session, destroyTarget, 1, 0);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const restored = registerAndRestore(session, workspace, reader);
  expectCleanRestore(restored);
  expectRestoredLegalActions(restored, 0);
  return { restored, chaotic, searchTarget, destroyTarget };
}

function createRestoredControlField({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}) {
  const session = createDuel({ seed: 92221403, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [chaoticCode] }, 1: { main: [controlTargetCode] } });
  startDuel(session);
  const chaotic = requireCard(session, chaoticCode);
  const controlTarget = requireCard(session, controlTargetCode);
  moveDuelCard(session.state, chaotic.uid, "graveyard", 0);
  moveFaceUpAttack(session, controlTarget, 1, 0);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const restored = registerAndRestore(session, workspace, reader);
  expectCleanRestore(restored);
  expectRestoredLegalActions(restored, 0);
  return { restored, chaotic, controlTarget };
}

function registerAndRestore(session: DuelSession, workspace: ReturnType<typeof createUpstreamNodeWorkspace>, reader: ReturnType<typeof createCardReader>) {
  const host = createLuaScriptHost(session, workspace, { promptOverrides });
  expect(host.loadCardScript(Number(chaoticCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader, { promptOverrides });
}

function cards(): DuelCardData[] {
  return [
    { code: chaoticCode, name: "Chaotic Elements", kind: "spell", typeFlags: typeSpell },
    highLevelElement(searchCode, "Chaotic Elements Search Target", racePyro, attributeLight),
    elementMonster(gravePyro1Code, "Chaotic Elements Grave Pyro 1", racePyro, attributeDark, 4),
    elementMonster(graveAquaCode, "Chaotic Elements Grave Aqua", raceAqua, attributeLight, 4),
    elementMonster(gravePyro2Code, "Chaotic Elements Grave Pyro 2", racePyro, attributeDark, 4),
    { code: destroyTargetCode, name: "Chaotic Elements Destroy Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeLight, level: 4, attack: 1700, defense: 1000 },
    highLevelElement(controlTargetCode, "Chaotic Elements Control Target", raceAqua, attributeDark),
  ];
}

function highLevelElement(code: string, name: string, race: number, attribute: number): DuelCardData {
  return elementMonster(code, name, race, attribute, 5);
}

function elementMonster(code: string, name: string, race: number, attribute: number, level: number): DuelCardData {
  return {
    code,
    name,
    kind: "monster",
    typeFlags: typeMonster | typeEffect,
    race,
    attribute,
    level,
    attack: 1800,
    defense: 1200,
  };
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function findCard(session: DuelSession, uid: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.uid === uid);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.sequence = sequence;
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

function passRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((candidate) => candidate.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}
