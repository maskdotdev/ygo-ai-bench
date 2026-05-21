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
const ggEzCode = "34365442";
const releaseCode = "343654420";
const targetCode = "343654421";
const starterCode = "343654422";
const destroyTargetCode = "343654423";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasGgEzScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${ggEzCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeSpell = 0x2;
const typeContinuous = 0x10000;
const setKiSikil = 0x153;
const setLilLa = 0x154;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasGgEzScript)("Lua real script Evil Twin GG EZ release stat negate", () => {
  it("restores release-cost targeting into a temporary Ki-sikil/Lil-la ATK boost", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${ggEzCode}.lua`);
    expectScriptShape(script);

    const { session, reader } = createSession(workspace, [ggEzCode, releaseCode, targetCode], []);
    const ggEz = requireCard(session, ggEzCode);
    const release = requireCard(session, releaseCode);
    const target = requireCard(session, targetCode);
    moveFaceUpSpell(session, ggEz, 0);
    moveFaceUpAttack(session, release, 0);
    moveFaceUpAttack(session, target, 0);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(ggEzCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const boost = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === ggEz.uid);
    expect(boost, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, boost!);
    passRestoredChain(restoredOpen);

    const restoredResolved = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredResolved);
    expectRestoredLegalActions(restoredResolved, 0);
    expect(restoredResolved.session.state.cards.find((card) => card.uid === release.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.cost | duelReason.release,
      reasonPlayer: 0,
      reasonCardUid: ggEz.uid,
      reasonEffectId: 2,
    });
    expect(currentAttack(restoredResolved.session.state.cards.find((card) => card.uid === target.uid), restoredResolved.session.state)).toBe(2500);
    expect(restoredResolved.session.state.effects.filter((effect) => effect.sourceUid === target.uid && effect.code === 100).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      value: effect.value,
    }))).toEqual([
      { code: 100, reset: { flags: 1107169792 }, value: 1500 },
    ]);
    expect(restoredResolved.session.state.eventHistory.filter((event) => event.eventName === "released" && event.eventCardUid === release.uid).map((event) => ({
      eventName: event.eventName,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
    }))).toEqual([
      {
        eventName: "released",
        eventCardUid: release.uid,
        eventReason: duelReason.cost | duelReason.release,
        eventReasonPlayer: 0,
        eventReasonCardUid: ggEz.uid,
        eventReasonEffectId: 2,
      },
    ]);
    expect(restoredResolved.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });

  it("restores release-cost chain response that negates a destruction effect", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const { session, reader, source } = createNegateSession(workspace);
    const ggEz = requireCard(session, ggEzCode);
    const release = requireCard(session, releaseCode);
    const starter = requireCard(session, starterCode);
    const destroyTarget = requireCard(session, destroyTargetCode);

    const host = createLuaScriptHost(session, workspace);
    for (const code of [ggEzCode, starterCode]) {
      const loaded = host.loadCardScript(Number(code), source);
      expect(loaded.ok, loaded.error).toBe(true);
    }
    expect(host.registerInitialEffects()).toBe(2);

    const restoredStarterOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredStarterOpen);
    expectRestoredLegalActions(restoredStarterOpen, 1);
    const starterAction = getLuaRestoreLegalActions(restoredStarterOpen, 1).find((action) => action.type === "activateEffect" && action.uid === starter.uid);
    expect(starterAction, JSON.stringify(getLuaRestoreLegalActions(restoredStarterOpen, 1), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredStarterOpen, starterAction!);
    expect(restoredStarterOpen.session.state.chain[0]?.operationInfos).toEqual([
      { category: 0x1, targetUids: [destroyTarget.uid], count: 1, player: 0, parameter: 0x4 },
    ]);

    const restoredChainResponse = restoreDuelWithLuaScripts(serializeDuel(restoredStarterOpen.session), source, reader);
    expectCleanRestore(restoredChainResponse);
    expectRestoredLegalActions(restoredChainResponse, 0);
    const negate = getLuaRestoreLegalActions(restoredChainResponse, 0).find((action) => action.type === "activateEffect" && action.uid === ggEz.uid);
    expect(negate, JSON.stringify(getLuaRestoreLegalActions(restoredChainResponse, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredChainResponse, negate!);
    passRestoredChain(restoredChainResponse);

    expect(restoredChainResponse.session.state.cards.find((card) => card.uid === release.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.cost | duelReason.release,
      reasonPlayer: 0,
      reasonCardUid: ggEz.uid,
      reasonEffectId: 3,
    });
    expect(restoredChainResponse.session.state.cards.find((card) => card.uid === destroyTarget.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
    });
    expect(restoredChainResponse.session.state.cards.find((card) => card.uid === starter.uid)).toMatchObject({
      location: "graveyard",
      controller: 1,
    });
    expect(restoredChainResponse.host.messages).not.toContain("gg ez destroy starter resolved");
    expect(restoredChainResponse.session.state.eventHistory.filter((event) => ["released", "chainNegated", "chainDisabled", "destroyed"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventChainLinkId: event.eventChainLinkId,
      relatedEffectId: event.relatedEffectId,
    }))).toEqual([
      {
        eventName: "released",
        eventCardUid: release.uid,
        eventReason: duelReason.cost | duelReason.release,
        eventReasonPlayer: 0,
        eventReasonCardUid: ggEz.uid,
        eventReasonEffectId: 3,
        eventChainLinkId: undefined,
        relatedEffectId: undefined,
      },
      {
        eventName: "chainNegated",
        eventCardUid: undefined,
        eventReason: undefined,
        eventReasonPlayer: 1,
        eventReasonCardUid: undefined,
        eventReasonEffectId: undefined,
        eventChainLinkId: "chain-2",
        relatedEffectId: 4,
      },
      {
        eventName: "chainDisabled",
        eventCardUid: undefined,
        eventReason: undefined,
        eventReasonPlayer: 1,
        eventReasonCardUid: undefined,
        eventReasonEffectId: undefined,
        eventChainLinkId: "chain-2",
        relatedEffectId: 4,
      },
    ]);
    expect(restoredChainResponse.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function createNegateSession(workspace: ReturnType<typeof createUpstreamNodeWorkspace>) {
  const { session, reader } = createSession(workspace, [ggEzCode, releaseCode, starterCode, destroyTargetCode], []);
  const ggEz = requireCard(session, ggEzCode);
  const release = requireCard(session, releaseCode);
  const starter = requireCard(session, starterCode);
  const destroyTarget = requireCard(session, destroyTargetCode);
  moveFaceUpSpell(session, ggEz, 0);
  moveFaceUpAttack(session, release, 0);
  moveDuelCard(session.state, starter.uid, "hand", 1);
  moveFaceUpAttack(session, destroyTarget, 0);
  session.state.phase = "main1";
  session.state.turnPlayer = 1;
  session.state.waitingFor = 1;
  const source = {
    readScript(name: string) {
      if (name === `c${starterCode}.lua`) return destroyStarterScript(destroyTargetCode);
      return workspace.readScript(name);
    },
  };
  return { session, reader, source };
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("e1:SetCountLimit(1,id,EFFECT_COUNT_CODE_OATH)");
  expect(script).toContain("Duel.CheckReleaseGroupCost(tp,s.cfilter,1,false,nil,nil,tp)");
  expect(script).toContain("Duel.SelectReleaseGroupCost(tp,s.cfilter,1,1,false,nil,nil,tp)");
  expect(script).toContain("Duel.Release(rg,REASON_COST)");
  expect(script).toContain("Duel.SelectTarget(tp,s.atktgfilter,tp,LOCATION_MZONE,0,1,1,nil)");
  expect(script).toContain("local tc=Duel.GetFirstTarget()");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("if not Duel.IsChainDisablable(ev) or re:GetHandler():IsDisabled() then return false end");
  expect(script).toContain("Duel.GetOperationInfo(ev,CATEGORY_DESTROY)");
  expect(script).toContain("Duel.CheckReleaseGroupCost(tp,s.cfilter2,1,false,nil,nil)");
  expect(script).toContain("Duel.SelectReleaseGroupCost(tp,s.cfilter2,1,1,false,nil,nil)");
  expect(script).toContain("Duel.NegateEffect(ev)");
}

function createSession(workspace: ReturnType<typeof createUpstreamNodeWorkspace>, main0: string[], main1: string[]) {
  const cards: DuelCardData[] = [
    ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === ggEzCode),
    { code: releaseCode, name: "GG EZ Release Ki-sikil", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setKiSikil], level: 4, attack: 1500, defense: 1000 },
    { code: targetCode, name: "GG EZ Target Lil-la", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setLilLa], level: 4, attack: 1000, defense: 1000 },
    { code: starterCode, name: "GG EZ Destruction Starter", kind: "spell", typeFlags: typeSpell },
    { code: destroyTargetCode, name: "GG EZ Destruction Target", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 900, defense: 900 },
  ];
  const reader = createCardReader(cards);
  const session = createDuel({ seed: 34365442, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: main0 }, 1: { main: main1 } });
  startDuel(session);
  return { session, reader };
}

function destroyStarterScript(targetCode: string): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetCategory(CATEGORY_DESTROY)
      e:SetType(EFFECT_TYPE_ACTIVATE)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetTarget(function(e,tp,eg,ep,ev,re,r,rp,chk)
        if chk==0 then return Duel.IsExistingMatchingCard(Card.IsCode,tp,0,LOCATION_MZONE,1,nil,${targetCode}) end
        local g=Duel.GetMatchingGroup(Card.IsCode,tp,0,LOCATION_MZONE,nil,${targetCode})
        Duel.SetOperationInfo(0,CATEGORY_DESTROY,g,1,1-tp,LOCATION_MZONE)
      end)
      e:SetOperation(function(e,tp)
        local g=Duel.GetMatchingGroup(Card.IsCode,tp,0,LOCATION_MZONE,nil,${targetCode})
        Duel.Destroy(g,REASON_EFFECT)
        Debug.Message("gg ez destroy starter resolved")
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

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
}

function moveFaceUpSpell(session: DuelSession, card: DuelCardInstance, player: PlayerId): void {
  const moved = moveDuelCard(session.state, card.uid, "spellTrapZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  moved.data.typeFlags = (moved.data.typeFlags ?? typeSpell) | typeContinuous;
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
