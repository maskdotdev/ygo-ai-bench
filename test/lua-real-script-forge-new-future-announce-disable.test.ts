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
const forgeCode = "27104921";
const starterCode = "271049210";
const linkCode = "271049211";
const declaredCode = "271049212";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasForgeScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${forgeCode}.lua`));
const promptOverrides = [{ api: "SelectYesNo" as const, player: 0 as const, returned: true }];
const counterForge = 0x20b;
const effectDisable = 2;
const effectDisableTrapMonster = 10;
const eventChainSolving = 1020;
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeEffect = 0x20;
const typeField = 0x80000;
const typeLink = 0x4000000;
const raceCyberse = 0x1000000;
const attributeDark = 0x20;

describe.skipIf(!hasUpstreamScripts || !hasForgeScript)("Lua real script Forge a New Future announce disable", () => {
  it("restores Link-4 summon trigger into counter placement and declared-card disable locks", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${forgeCode}.lua`);
    expectScriptShape(script);
    const source = fixtureSource(workspace);
    const reader = createCardReader(cards());
    const session = createDuel({ seed: 27104921, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [forgeCode, starterCode, declaredCode], extra: [linkCode] }, 1: { main: [] } });
    startDuel(session);

    const forge = requireCard(session, forgeCode);
    const starter = requireCard(session, starterCode);
    const link = requireCard(session, linkCode);
    moveFaceUpSpell(session, forge);
    moveDuelCard(session.state, starter.uid, "hand", 0);
    moveDuelCard(session.state, requireCard(session, declaredCode).uid, "monsterZone", 1).faceUp = true;
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, source, { promptOverrides });
    expect(host.loadCardScript(Number(forgeCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(starterCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader, { promptOverrides });
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const starterAction = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === starter.uid);
    expect(starterAction, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, starterAction!);
    expect(findCard(restoredOpen.session, link.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: starter.uid,
      reasonEffectId: 5,
      summonType: "link",
    });

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader, { promptOverrides });
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === forge.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, trigger!);
    resolveRestoredChain(restoredTrigger);

    expect(getDuelCardCounter(findCard(restoredTrigger.session, forge.uid), counterForge)).toBe(0);
    expect(restoredTrigger.host.promptDecisions).toEqual([
      { id: "lua-prompt-1", api: "SelectYesNo", player: 0, description: 433678737, returned: true },
      {
        id: "lua-prompt-2",
        api: "AnnounceCard",
        player: 0,
        options: [Number(forgeCode), Number(starterCode), Number(linkCode), Number(declaredCode)],
        descriptions: [Number(forgeCode), Number(starterCode), Number(linkCode), Number(declaredCode)],
        returned: Number(forgeCode),
      },
    ]);
    expect(restoredTrigger.session.state.effects.filter((effect) =>
      [effectDisable, eventChainSolving, effectDisableTrapMonster].includes(effect.code ?? -1) && effect.sourceUid === forge.uid
    ).map((effect) => ({
      code: effect.code,
      event: effect.event,
      label: effect.label,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      targetRange: effect.targetRange,
    }))).toEqual([
      { code: effectDisable, event: "continuous", label: Number(forgeCode), reset: { flags: 1073742336 }, sourceUid: forge.uid, targetRange: [12, 12] },
      { code: eventChainSolving, event: "continuous", label: Number(forgeCode), reset: { flags: 1073742336 }, sourceUid: forge.uid, targetRange: undefined },
      { code: effectDisableTrapMonster, event: "continuous", label: Number(forgeCode), reset: { flags: 1073742336 }, sourceUid: forge.uid, targetRange: [4, 4] },
    ]);
    expect(restoredTrigger.session.state.eventHistory.filter((event) =>
      ["specialSummoned", "counterAdded", "breakEffect"].includes(event.eventName)
    ).map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
    }))).toEqual([
      { eventCardUid: link.uid, eventCode: 1102, eventName: "specialSummoned", eventReason: duelReason.summon | duelReason.specialSummon, eventReasonCardUid: starter.uid, eventReasonEffectId: 5, eventReasonPlayer: 0 },
      { eventCardUid: forge.uid, eventCode: 0x10000, eventName: "counterAdded", eventReason: duelReason.effect, eventReasonCardUid: forge.uid, eventReasonEffectId: 4, eventReasonPlayer: 0 },
      { eventCardUid: undefined, eventCode: 1050, eventName: "breakEffect", eventReason: duelReason.effect, eventReasonCardUid: forge.uid, eventReasonEffectId: 4, eventReasonPlayer: 0 },
    ]);
  });
});

function cards(): DuelCardData[] {
  return [
    { code: forgeCode, name: "Forge a New Future", kind: "spell", typeFlags: typeSpell | typeField },
    { code: starterCode, name: "Forge Link Starter", kind: "spell", typeFlags: typeSpell },
    { code: linkCode, name: "Forge Link-4 Trigger", kind: "extra", typeFlags: typeMonster | typeEffect | typeLink, race: raceCyberse, attribute: attributeDark, level: 4, attack: 2500, defense: 0, linkMarkers: 0x2b },
    { code: declaredCode, name: "Forge Declared Disabled Monster", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
  ];
}

function fixtureSource(workspace: ReturnType<typeof createUpstreamNodeWorkspace>) {
  return {
    readScript(name: string) {
      if (name === `c${starterCode}.lua`) return starterScript();
      return workspace.readScript(name);
    },
  };
}

function starterScript(): string {
  return `
local s,id=GetID()
function s.initial_effect(c)
  local e=Effect.CreateEffect(c)
  e:SetType(EFFECT_TYPE_ACTIVATE)
  e:SetCode(EVENT_FREE_CHAIN)
  e:SetOperation(function(e,tp)
    local g=Duel.SelectMatchingCard(tp,aux.FilterBoolFunction(Card.IsCode,${linkCode}),tp,LOCATION_EXTRA,0,1,1,nil)
    local tc=g:GetFirst()
    if tc then Duel.SpecialSummon(tc,SUMMON_TYPE_LINK,tp,tp,false,false,POS_FACEUP_ATTACK) end
  end)
  c:RegisterEffect(e)
end
`;
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toContain("c:EnableCounterPermit(0x20b)");
  expect(script).toContain("c:SetCounterLimit(0x20b,3)");
  expect(script).toContain("e0:SetCode(EVENT_FREE_CHAIN)");
  expect(script).toContain("e1:SetCategory(CATEGORY_COUNTER+CATEGORY_SPECIAL_SUMMON+CATEGORY_TOGRAVE)");
  expect(script).toContain("e1:SetCode(EVENT_SPSUMMON_SUCCESS)");
  expect(script).toContain("return c:IsType(TYPE_LINK) and c:IsLinkSummoned() and c:IsLink(4)");
  expect(script).toContain("Duel.SetPossibleOperationInfo(0,CATEGORY_TOGRAVE,e:GetHandler(),1,tp,0)");
  expect(script).toContain("Duel.SetPossibleOperationInfo(0,CATEGORY_SPECIAL_SUMMON,nil,1,tp,LOCATION_GRAVE|LOCATION_EXTRA)");
  expect(script).toContain("Duel.SelectYesNo(tp,aux.Stringid(id,1))");
  expect(script).toContain("Duel.AnnounceCard(tp)");
  expect(script).toContain("Duel.BreakEffect()");
  expect(script).toContain("e1:SetCode(EFFECT_DISABLE)");
  expect(script).toContain("e2:SetCode(EVENT_CHAIN_SOLVING)");
  expect(script).toContain("Duel.NegateEffect(ev)");
  expect(script).toContain("e3:SetCode(EFFECT_DISABLE_TRAPMONSTER)");
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

function moveFaceUpSpell(session: DuelSession, card: DuelCardInstance): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "spellTrapZone", 0);
  moved.faceUp = true;
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
