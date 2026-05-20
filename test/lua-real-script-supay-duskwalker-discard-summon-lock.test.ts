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
const supayCode = "17315396";
const scoutCode = "78552773";
const discardCode = "17315397";
const fusionProbeCode = "17315398";
const synchroProbeCode = "17315399";
const hasSupayScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${supayCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeFusion = 0x40;
const typeSynchro = 0x2000;
const raceFiend = 0x8;
const raceDragon = 0x2000;
const attributeDark = 0x20;
const effectCannotSpecialSummon = 22;
const clockLizardCheck = 51476410;
const duelActivitySpecialSummon = 0x4;

describe.skipIf(!hasUpstreamScripts || !hasSupayScript)("Lua real script Supay Duskwalker discard summon lock", () => {
  it("restores discard-cost self summon, optional listed summon, and Extra Deck Synchro oath", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`c${supayCode}.lua`);
    expect(script).toContain("Duel.AddCustomActivityCounter(id,ACTIVITY_SPSUMMON,s.counterfilter)");
    expect(script).toContain("Duel.GetCustomActivityCount(id,tp,ACTIVITY_SPSUMMON)==0");
    expect(script).toContain("Duel.DiscardHand(tp,Card.IsDiscardable,1,1,REASON_COST|REASON_DISCARD,c)");
    expect(script).toContain("e1:SetCode(EFFECT_CANNOT_SPECIAL_SUMMON)");
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_PLAYER_TARGET+EFFECT_FLAG_OATH+EFFECT_FLAG_CLIENT_HINT)");
    expect(script).toContain("aux.addTempLizardCheck(e:GetHandler(),tp,s.lizfilter)");
    expect(script).toContain("return not c:IsOriginalType(TYPE_SYNCHRO)");
    expect(script).toContain("Duel.SelectYesNo(tp,aux.Stringid(id,1))");
    expect(script).toContain("Duel.SelectMatchingCard(tp,s.spfilter,tp,LOCATION_DECK|LOCATION_HAND,0,1,1,nil,e,tp)");

    const cards: DuelCardData[] = [
      { code: supayCode, name: "Supay, Duskwalker", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFiend, attribute: attributeDark, level: 5, attack: 2200, defense: 1900 },
      { code: scoutCode, name: "Supay Scout Listed Summon", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFiend, attribute: attributeDark, level: 1, attack: 300, defense: 100 },
      { code: discardCode, name: "Supay Discard Cost", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFiend, attribute: attributeDark, level: 4, attack: 1000, defense: 1000 },
      { code: fusionProbeCode, name: "Supay Fusion Probe", kind: "extra", typeFlags: typeMonster | typeFusion, race: raceDragon, attribute: attributeDark, level: 6, attack: 1000, defense: 1000 },
      { code: synchroProbeCode, name: "Supay Synchro Probe", kind: "extra", typeFlags: typeMonster | typeSynchro, race: raceDragon, attribute: attributeDark, level: 6, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 17315396, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [supayCode, scoutCode, discardCode], extra: [fusionProbeCode, synchroProbeCode] }, 1: { main: [] } });
    startDuel(session);

    const supay = requireCard(session, supayCode);
    const scout = requireCard(session, scoutCode);
    const discard = requireCard(session, discardCode);
    moveDuelCard(session.state, supay.uid, "hand", 0);
    moveDuelCard(session.state, discard.uid, "hand", 0);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(supayCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(session.state.activityHistory.filter((record) => record.player === 0 && record.activity === duelActivitySpecialSummon)).toEqual([]);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const activation = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === supay.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredOpen, activation!);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === discard.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.cost | duelReason.discard,
      reasonCardUid: supay.uid,
      reasonEffectId: 1,
    });
    expect(restoredOpen.session.state.chain).toEqual([]);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === supay.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpDefense",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonCardUid: supay.uid,
      reasonEffectId: 1,
    });
    expect(restoredOpen.session.state.cards.find((card) => card.uid === scout.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonCardUid: supay.uid,
      reasonEffectId: 1,
    });
    expect(restoredOpen.host.promptDecisions).toEqual([
      { id: "lua-prompt-1", api: "SelectYesNo", player: 0, description: 277046337, returned: true },
    ]);
    expect(restoredOpen.session.state.activityHistory.filter((record) => record.player === 0 && record.activity === duelActivitySpecialSummon)).toEqual([
      { player: 0, activity: duelActivitySpecialSummon, cardUid: supay.uid },
      { player: 0, activity: duelActivitySpecialSummon, cardUid: scout.uid },
    ]);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.code === effectCannotSpecialSummon)).toEqual([
      expect.objectContaining({
        code: effectCannotSpecialSummon,
        luaTargetDescriptor: "special-summon-limit:not-type-extra:8192",
        property: 0x4080800,
        sourceUid: supay.uid,
        targetRange: [1, 0],
      }),
    ]);
    expect(restoredOpen.session.state.effects.find((effect) => effect.code === clockLizardCheck)).toMatchObject({
      luaTargetDescriptor: "target:not-original-type:8192",
      sourceUid: supay.uid,
      value: 1,
    });
    expect(restoredOpen.session.state.eventHistory.filter((event) => event.eventName === "discarded" && event.eventCardUid === discard.uid)).toEqual([
      {
        eventName: "discarded",
        eventCode: 1018,
        eventCardUid: discard.uid,
        eventReason: duelReason.cost | duelReason.discard,
        eventReasonPlayer: 0,
        eventReasonCardUid: supay.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 1 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
      },
    ]);

    const restoredLocked = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredLocked);
    expectRestoredLegalActions(restoredLocked, 0);
    const probe = restoredLocked.host.loadScript(
      `
      local fusion=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${fusionProbeCode}),0,LOCATION_EXTRA,0,nil)
      local synchro=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${synchroProbeCode}),0,LOCATION_EXTRA,0,nil)
      Debug.Message("supay fusion extra special " .. Duel.SpecialSummon(fusion,SUMMON_TYPE_FUSION,0,0,false,false,POS_FACEUP_ATTACK))
      Debug.Message("supay synchro extra special " .. Duel.SpecialSummon(synchro,SUMMON_TYPE_SYNCHRO,0,0,false,false,POS_FACEUP_ATTACK))
      `,
      "supay-duskwalker-extra-synchro-oath-probe.lua",
    );
    expect(probe.ok, probe.error).toBe(true);
    expect(restoredLocked.host.messages).toEqual(
      expect.arrayContaining([
        "supay fusion extra special 0",
        "supay synchro extra special 1",
      ]),
    );
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

function passRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restored, pass!);
  }
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
