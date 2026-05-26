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
const placeCode = "16269385";
const fusionStarterCode = "162693850";
const linkStarterCode = "162693851";
const searchPrankCode = "162693852";
const fusionPrankCode = "162693853";
const linkPrankCode = "162693854";
const allyCode = "162693855";
const opponentACode = "162693856";
const opponentBCode = "162693857";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasPlaceScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${placeCode}.lua`));
const setPrankKids = 0x120;
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeEffect = 0x20;
const typeFusion = 0x40;
const typeField = 0x80000;
const typeLink = 0x4000000;
const racePyro = 0x80;
const raceThunder = 0x1000;
const attributeFire = 0x4;
const attributeLight = 0x10;
const effectUpdateAttack = 100;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasPlaceScript)("Lua real script Prank-Kids Place summon search stat", () => {
  it("restores activation search plus Fusion and Link Summon ATK swings", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${placeCode}.lua`);
    expectScriptShape(script);
    const source = fixtureSource(workspace);
    const reader = createCardReader(cards(workspace));

    const activation = createRestoredActivationField({ reader, source, workspace });
    expectCleanRestore(activation.restored);
    expectRestoredLegalActions(activation.restored, 0);
    const activatePlace = getLuaRestoreLegalActions(activation.restored, 0).find((action) =>
      action.type === "activateEffect" && action.uid === activation.place.uid
    );
    expect(activatePlace, JSON.stringify(getLuaRestoreLegalActions(activation.restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(activation.restored, activatePlace!);
    resolveRestoredChain(activation.restored);
    expect(findCard(activation.restored.session, activation.place.uid)).toMatchObject({
      location: "spellTrapZone",
      controller: 0,
      faceUp: true,
    });
    expect(findCard(activation.restored.session, activation.searchTarget.uid)).toMatchObject({
      location: "hand",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: activation.place.uid,
      reasonEffectId: 1,
    });
    expect(activation.restored.host.promptDecisions.filter((prompt) => prompt.api === "SelectYesNo").map((prompt) => ({
      api: prompt.api,
      player: prompt.player,
      returned: prompt.returned,
    }))).toEqual([{ api: "SelectYesNo", player: 0, returned: true }]);
    expect(activation.restored.host.messages).toContain(`confirmed 1: ${searchPrankCode}`);
    expect(activation.restored.session.state.eventHistory.filter((event) => ["sentToHand", "confirmed", "sentToHandConfirmed"].includes(event.eventName)).map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventPlayer: event.eventPlayer,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
    }))).toEqual([
      { eventCardUid: activation.searchTarget.uid, eventCode: 1012, eventName: "sentToHand", eventPlayer: undefined, eventReason: duelReason.effect, eventReasonCardUid: activation.place.uid, eventReasonEffectId: 1, eventReasonPlayer: 0 },
      { eventCardUid: activation.searchTarget.uid, eventCode: 1211, eventName: "confirmed", eventPlayer: 1, eventReason: duelReason.effect, eventReasonCardUid: activation.place.uid, eventReasonEffectId: 1, eventReasonPlayer: 0 },
      { eventCardUid: activation.searchTarget.uid, eventCode: 1212, eventName: "sentToHandConfirmed", eventPlayer: 1, eventReason: duelReason.effect, eventReasonCardUid: activation.place.uid, eventReasonEffectId: 1, eventReasonPlayer: 0 },
    ]);
    expect(activation.restored.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });

    const fusion = createRestoredFusionField({ reader, source, workspace });
    expectCleanRestore(fusion.restored);
    expectRestoredLegalActions(fusion.restored, 0);
    const fusionSummon = getLuaRestoreLegalActions(fusion.restored, 0).find((action) =>
      action.type === "activateEffect" && action.uid === fusion.starter.uid
    );
    expect(fusionSummon, JSON.stringify(getLuaRestoreLegalActions(fusion.restored, 0), null, 2)).toBeDefined();
    if (!fusionSummon || fusionSummon.type !== "activateEffect") throw new Error("Missing Prank-Kids Fusion starter");
    const fusionStarterEffectId = Number(fusionSummon.effectId.match(/^lua-(\d+)/)?.[1]);
    applyRestoredActionAndAssert(fusion.restored, fusionSummon);
    resolveRestoredChain(fusion.restored);
    expect(findCard(fusion.restored.session, fusion.fusion.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      summonType: "fusion",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: fusion.starter.uid,
      reasonEffectId: fusionStarterEffectId,
    });

    const restoredFusionTrigger = restoreDuelWithLuaScripts(serializeDuel(fusion.restored.session), source, reader);
    expectCleanRestore(restoredFusionTrigger);
    expectRestoredLegalActions(restoredFusionTrigger, 0);
    const fusionTrigger = getLuaRestoreLegalActions(restoredFusionTrigger, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === fusion.place.uid
    );
    expect(fusionTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredFusionTrigger, 0), null, 2)).toBeDefined();
    if (!fusionTrigger || fusionTrigger.type !== "activateTrigger") throw new Error("Missing Prank-Kids Place Fusion boost trigger");
    const fusionBoostEffectId = Number(fusionTrigger.effectId.match(/^lua-(\d+)/)?.[1]);
    applyRestoredActionAndAssert(restoredFusionTrigger, fusionTrigger);
    resolveRestoredChain(restoredFusionTrigger);
    expect(fusionBoostEffectId).toBe(2);
    expect(currentAttack(findCard(restoredFusionTrigger.session, fusion.starter.uid), restoredFusionTrigger.session.state)).toBe(1500);
    expect(currentAttack(findCard(restoredFusionTrigger.session, fusion.ally.uid), restoredFusionTrigger.session.state)).toBe(1400);
    expect(currentAttack(findCard(restoredFusionTrigger.session, fusion.fusion.uid), restoredFusionTrigger.session.state)).toBe(2500);
    expect(restoredFusionTrigger.session.state.effects.filter((effect) =>
      [fusion.starter.uid, fusion.ally.uid, fusion.fusion.uid].includes(effect.sourceUid) && effect.code === effectUpdateAttack
    ).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, reset: { flags: 33427456 }, sourceUid: fusion.starter.uid, value: 500 },
      { code: effectUpdateAttack, reset: { flags: 33427456 }, sourceUid: fusion.ally.uid, value: 500 },
      { code: effectUpdateAttack, reset: { flags: 33427456 }, sourceUid: fusion.fusion.uid, value: 500 },
    ]);
    expect(restoredFusionTrigger.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });

    const link = createRestoredLinkField({ reader, source, workspace });
    expectCleanRestore(link.restored);
    expectRestoredLegalActions(link.restored, 0);
    const linkSummon = getLuaRestoreLegalActions(link.restored, 0).find((action) =>
      action.type === "activateEffect" && action.uid === link.starter.uid
    );
    expect(linkSummon, JSON.stringify(getLuaRestoreLegalActions(link.restored, 0), null, 2)).toBeDefined();
    if (!linkSummon || linkSummon.type !== "activateEffect") throw new Error("Missing Prank-Kids Link starter");
    const linkStarterEffectId = Number(linkSummon.effectId.match(/^lua-(\d+)/)?.[1]);
    applyRestoredActionAndAssert(link.restored, linkSummon);
    resolveRestoredChain(link.restored);
    expect(findCard(link.restored.session, link.link.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      summonType: "link",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: link.starter.uid,
      reasonEffectId: linkStarterEffectId,
    });

    const restoredLinkTrigger = restoreDuelWithLuaScripts(serializeDuel(link.restored.session), source, reader);
    expectCleanRestore(restoredLinkTrigger);
    expectRestoredLegalActions(restoredLinkTrigger, 0);
    const linkTrigger = getLuaRestoreLegalActions(restoredLinkTrigger, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === link.place.uid
    );
    expect(linkTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredLinkTrigger, 0), null, 2)).toBeDefined();
    if (!linkTrigger || linkTrigger.type !== "activateTrigger") throw new Error("Missing Prank-Kids Place Link drop trigger");
    const linkDropEffectId = Number(linkTrigger.effectId.match(/^lua-(\d+)/)?.[1]);
    applyRestoredActionAndAssert(restoredLinkTrigger, linkTrigger);
    resolveRestoredChain(restoredLinkTrigger);
    expect(linkDropEffectId).toBe(3);
    expect(currentAttack(findCard(restoredLinkTrigger.session, link.opponentA.uid), restoredLinkTrigger.session.state)).toBe(1200);
    expect(currentAttack(findCard(restoredLinkTrigger.session, link.opponentB.uid), restoredLinkTrigger.session.state)).toBe(1300);
    expect(currentAttack(findCard(restoredLinkTrigger.session, link.link.uid), restoredLinkTrigger.session.state)).toBe(1800);
    expect(restoredLinkTrigger.session.state.effects.filter((effect) =>
      [link.opponentA.uid, link.opponentB.uid].includes(effect.sourceUid) && effect.code === effectUpdateAttack
    ).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, reset: { flags: 33427456 }, sourceUid: link.opponentA.uid, value: -500 },
      { code: effectUpdateAttack, reset: { flags: 33427456 }, sourceUid: link.opponentB.uid, value: -500 },
    ]);
    expect(restoredLinkTrigger.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

type ScriptSource = { readScript(name: string): string | undefined };

function createRestoredActivationField({
  reader,
  source,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  source: ScriptSource;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): {
  restored: ReturnType<typeof restoreDuelWithLuaScripts>;
  place: DuelCardInstance;
  searchTarget: DuelCardInstance;
} {
  const session = createDuel({ seed: 16269385, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [placeCode, searchPrankCode] }, 1: { main: [] } });
  startDuel(session);
  const place = requireCard(session, placeCode);
  const searchTarget = requireCard(session, searchPrankCode);
  moveDuelCard(session.state, place.uid, "hand", 0);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(placeCode), source).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
  return { restored, place, searchTarget };
}

function createRestoredFusionField({
  reader,
  source,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  source: ScriptSource;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): {
  restored: ReturnType<typeof restoreDuelWithLuaScripts>;
  place: DuelCardInstance;
  starter: DuelCardInstance;
  ally: DuelCardInstance;
  fusion: DuelCardInstance;
} {
  const session = createDuel({ seed: 16269386, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [placeCode, fusionStarterCode, allyCode], extra: [fusionPrankCode] }, 1: { main: [] } });
  startDuel(session);
  const place = requireCard(session, placeCode);
  const starter = requireCard(session, fusionStarterCode);
  const ally = requireCard(session, allyCode);
  const fusion = requireCard(session, fusionPrankCode);
  moveFaceUpFieldSpell(session, place, 0);
  moveFaceUpAttack(session, starter, 0, 0);
  moveFaceUpAttack(session, ally, 0, 1);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(placeCode), source).ok).toBe(true);
  expect(host.loadCardScript(Number(fusionStarterCode), source).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(2);
  const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
  return { restored, place, starter, ally, fusion };
}

function createRestoredLinkField({
  reader,
  source,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  source: ScriptSource;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): {
  restored: ReturnType<typeof restoreDuelWithLuaScripts>;
  place: DuelCardInstance;
  starter: DuelCardInstance;
  link: DuelCardInstance;
  opponentA: DuelCardInstance;
  opponentB: DuelCardInstance;
} {
  const session = createDuel({ seed: 16269387, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [placeCode, linkStarterCode], extra: [linkPrankCode] }, 1: { main: [opponentACode, opponentBCode] } });
  startDuel(session);
  const place = requireCard(session, placeCode);
  const starter = requireCard(session, linkStarterCode);
  const link = requireCard(session, linkPrankCode);
  const opponentA = requireCard(session, opponentACode);
  const opponentB = requireCard(session, opponentBCode);
  moveFaceUpFieldSpell(session, place, 0);
  moveFaceUpAttack(session, starter, 0, 0);
  moveFaceUpAttack(session, opponentA, 1, 0);
  moveFaceUpAttack(session, opponentB, 1, 1);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(placeCode), source).ok).toBe(true);
  expect(host.loadCardScript(Number(linkStarterCode), source).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(2);
  const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
  return { restored, place, starter, link, opponentA, opponentB };
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Prank-Kids Place");
  expect(script).toContain("e1:SetCategory(CATEGORY_TOHAND+CATEGORY_SEARCH)");
  expect(script).toContain("e1:SetType(EFFECT_TYPE_ACTIVATE)");
  expect(script).toContain("e1:SetCode(EVENT_FREE_CHAIN)");
  expect(script).toContain("e1:SetCountLimit(1,id,EFFECT_COUNT_CODE_OATH)");
  expect(script).toContain("Duel.GetMatchingGroup(s.thfilter,tp,LOCATION_DECK,0,nil)");
  expect(script).toContain("Duel.SelectYesNo(tp,aux.Stringid(id,0))");
  expect(script).toContain("Duel.SendtoHand(sg,nil,REASON_EFFECT)");
  expect(script).toContain("Duel.ConfirmCards(1-tp,sg)");
  expect(script).toContain("e2:SetCategory(CATEGORY_ATKCHANGE)");
  expect(script).toContain("e2:SetCode(EVENT_SPSUMMON_SUCCESS)");
  expect(script).toContain("e2:SetRange(LOCATION_FZONE)");
  expect(script).toContain("return eg:IsExists(s.cfilter,1,nil,tp,SUMMON_TYPE_FUSION)");
  expect(script).toContain("Duel.GetMatchingGroup(Card.IsFaceup,tp,LOCATION_MZONE,0,nil)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(500)");
  expect(script).toContain("e3:SetCode(EVENT_SPSUMMON_SUCCESS)");
  expect(script).toContain("return eg:IsExists(s.cfilter,1,nil,tp,SUMMON_TYPE_LINK)");
  expect(script).toContain("Duel.GetMatchingGroup(Card.IsFaceup,tp,0,LOCATION_MZONE,nil)");
  expect(script).toContain("e1:SetValue(-500)");
}

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const place = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === placeCode);
  expect(place).toBeDefined();
  return [
    { ...place!, kind: "spell", typeFlags: typeSpell | typeField, setcodes: [setPrankKids] },
    { code: fusionStarterCode, name: "Prank-Kids Place Fusion Starter", kind: "monster", typeFlags: typeMonster | typeEffect, race: racePyro, attribute: attributeFire, level: 4, attack: 1000, defense: 1000 },
    { code: linkStarterCode, name: "Prank-Kids Place Link Starter", kind: "monster", typeFlags: typeMonster | typeEffect, race: racePyro, attribute: attributeFire, level: 4, attack: 1000, defense: 1000 },
    prankMonster(searchPrankCode, "Prank-Kids Place Search Target", 1200, 1000),
    { code: fusionPrankCode, name: "Prank-Kids Place Fusion", kind: "extra", typeFlags: typeMonster | typeEffect | typeFusion, setcodes: [setPrankKids], race: racePyro, attribute: attributeFire, level: 5, attack: 2000, defense: 1000 },
    { code: linkPrankCode, name: "Prank-Kids Place Link", kind: "extra", typeFlags: typeMonster | typeEffect | typeLink, setcodes: [setPrankKids], race: racePyro, attribute: attributeFire, level: 2, attack: 1800, defense: 0, linkMarkers: 0x28, linkMaterialMin: 1, linkMaterialMax: 1 },
    { code: allyCode, name: "Prank-Kids Place Ally", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceThunder, attribute: attributeLight, level: 4, attack: 900, defense: 900 },
    { code: opponentACode, name: "Prank-Kids Place Opponent A", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceThunder, attribute: attributeLight, level: 4, attack: 1700, defense: 1000 },
    { code: opponentBCode, name: "Prank-Kids Place Opponent B", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceThunder, attribute: attributeLight, level: 4, attack: 1800, defense: 1000 },
  ];
}

function prankMonster(code: string, name: string, attack: number, defense: number): DuelCardData {
  return { code, name, kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setPrankKids], race: racePyro, attribute: attributeFire, level: 4, attack, defense };
}

function fixtureSource(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): ScriptSource {
  return {
    readScript(name: string) {
      if (name === `c${fusionStarterCode}.lua`) return starterScript(fusionPrankCode, "SUMMON_TYPE_FUSION");
      if (name === `c${linkStarterCode}.lua`) return starterScript(linkPrankCode, "SUMMON_TYPE_LINK");
      return workspace.readScript(name) ?? workspace.readScript(`official/${name}`);
    },
  };
}

function starterScript(targetCode: string, summonType: "SUMMON_TYPE_FUSION" | "SUMMON_TYPE_LINK"): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_IGNITION)
      e:SetRange(LOCATION_MZONE)
      e:SetOperation(function(e,tp)
        local tc=Duel.SelectMatchingCard(tp,aux.FilterBoolFunction(Card.IsCode,${targetCode}),tp,LOCATION_EXTRA,0,1,1,nil):GetFirst()
        if tc then Duel.SpecialSummon(tc,${summonType},tp,tp,false,false,POS_FACEUP_ATTACK) end
      end)
      c:RegisterEffect(e)
    end
  `;
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

function moveFaceUpFieldSpell(session: DuelSession, card: DuelCardInstance, player: PlayerId): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "spellTrapZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  moved.sequence = 5;
  return moved;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  moved.sequence = sequence;
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
