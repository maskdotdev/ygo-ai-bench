import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const harpCode = "57835716";
const orcustTargetCode = "57835717";
const darkProbeCode = "57835718";
const lightProbeCode = "57835719";
const hasHarpScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${harpCode}.lua`));
const typeMonster = 0x1;
const setOrcust = 0x11b;
const attributeDark = 0x20;
const attributeLight = 0x10;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasHarpScript)("Lua real script Orcust Harp Horror self-banish deck summon lock", () => {
  it("restores grave ignition SelfBanish deck summon and operation-created DARK summon oath", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`c${harpCode}.lua`);
    expect(script).toContain("e1:SetType(EFFECT_TYPE_IGNITION)");
    expect(script).toContain("e1:SetRange(LOCATION_GRAVE)");
    expect(script).toContain("e1:SetCost(Cost.SelfBanish)");
    expect(script).toContain("e2:SetType(EFFECT_TYPE_QUICK_O)");
    expect(script).toContain("return not Duel.IsPlayerAffectedByEffect(tp,CARD_ORCUSTRATED_BABEL)");
    expect(script).toContain("return Duel.IsPlayerAffectedByEffect(tp,CARD_ORCUSTRATED_BABEL)");
    expect(script).toContain("return c:IsSetCard(SET_ORCUST) and c:IsCanBeSpecialSummoned(e,0,tp,false,false) and not c:IsCode(id)");
    expect(script).toContain("Duel.SelectMatchingCard(tp,s.filter,tp,LOCATION_DECK,0,1,1,nil,e,tp)");
    expect(script).toContain("Duel.SpecialSummon(g,0,tp,tp,false,false,POS_FACEUP)");
    expect(script).toContain("e1:SetCode(EFFECT_CANNOT_SPECIAL_SUMMON)");
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_PLAYER_TARGET+EFFECT_FLAG_OATH)");
    expect(script).toContain("e1:SetTarget(s.splimit)");
    expect(script).toContain("aux.RegisterClientHint(e:GetHandler(),nil,tp,1,0,aux.Stringid(id,1),nil)");
    expect(script).toContain("return not c:IsAttribute(ATTRIBUTE_DARK)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === harpCode),
      { code: orcustTargetCode, name: "Orcust Harp Deck Target", kind: "monster", typeFlags: typeMonster, setcodes: [setOrcust], attribute: attributeDark, level: 4, attack: 1600, defense: 1000 },
      { code: darkProbeCode, name: "Orcust Harp DARK Probe", kind: "monster", typeFlags: typeMonster, attribute: attributeDark, level: 4, attack: 1000, defense: 1000 },
      { code: lightProbeCode, name: "Orcust Harp LIGHT Probe", kind: "monster", typeFlags: typeMonster, attribute: attributeLight, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 57835716, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [harpCode, orcustTargetCode, darkProbeCode, lightProbeCode] }, 1: { main: [] } });
    startDuel(session);

    const harp = requireCard(session, harpCode);
    const orcustTarget = requireCard(session, orcustTargetCode);
    const darkProbe = requireCard(session, darkProbeCode);
    const lightProbe = requireCard(session, lightProbeCode);
    moveDuelCard(session.state, harp.uid, "graveyard", 0);
    moveDuelCard(session.state, orcustTarget.uid, "deck", 0);
    moveDuelCard(session.state, darkProbe.uid, "hand", 0);
    moveDuelCard(session.state, lightProbe.uid, "hand", 0);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(harpCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const ignition = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === harp.uid);
    expect(ignition, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredOpen, ignition!);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === harp.uid)).toMatchObject({
      location: "banished",
      previousLocation: "graveyard",
      reason: duelReason.cost,
    });
    expect(restoredOpen.session.state.eventHistory.filter((event) => event.eventName === "banished" && event.eventCardUid === harp.uid)).toEqual([
      {
        eventName: "banished",
        eventCode: 1011,
        eventCardUid: harp.uid,
        eventReason: duelReason.cost,
        eventReasonPlayer: 0,
        eventReasonCardUid: harp.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "banished", position: "faceDown", sequence: 0 },
      },
    ]);
    expect(restoredOpen.session.state.chain).toEqual([]);

    const restoredResolved = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredResolved);
    expectRestoredLegalActions(restoredResolved, 0);
    expect(restoredResolved.session.state.cards.find((card) => card.uid === orcustTarget.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonCardUid: harp.uid,
      reasonEffectId: 1,
    });
    expect(restoredResolved.session.state.eventHistory.filter((event) => event.eventName === "specialSummoned" && event.eventCardUid === orcustTarget.uid)).toEqual([
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: orcustTarget.uid,
        eventUids: [orcustTarget.uid],
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventReasonCardUid: harp.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 2 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
    ]);
    expect(restoredResolved.session.state.effects.find((effect) => effect.code === 22 && effect.sourceUid === harp.uid)).toMatchObject({
      event: "continuous",
      property: 0x80800,
      targetRange: [1, 0],
      luaTargetDescriptor: "target:not-attribute:32",
      reset: { flags: 0x40000200 },
    });

    const restoredLock = restoreDuelWithLuaScripts(serializeDuel(restoredResolved.session), workspace, reader);
    expectCleanRestore(restoredLock);
    expectRestoredLegalActions(restoredLock, 0);
    const probe = restoredLock.host.loadScript(
      `
      local dark=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${darkProbeCode}),0,LOCATION_HAND,0,nil)
      local light=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${lightProbeCode}),0,LOCATION_HAND,0,nil)
      Debug.Message("harp dark special " .. Duel.SpecialSummon(dark,0,0,0,false,false,POS_FACEUP_ATTACK))
      Debug.Message("harp light special " .. Duel.SpecialSummon(light,0,0,0,false,false,POS_FACEUP_ATTACK))
      `,
      "orcust-harp-dark-lock-probe.lua",
    );
    expect(probe.ok, probe.error).toBe(true);
    expect(restoredLock.host.messages.slice(-2)).toEqual(["harp dark special 1", "harp light special 0"]);
  });
});

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function expectCleanRestore(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
  expect(restored.missingRegistryKeys).toEqual([]);
  expect(restored.missingChainLimitRegistryKeys).toEqual([]);
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
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
    applyLuaRestoreAndAssert(restored, pass!);
  }
}
