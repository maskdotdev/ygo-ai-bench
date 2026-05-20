import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const kauwloonCode = "14886190";
const hasKauwloonScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${kauwloonCode}.lua`));
const gateCode = "148861900";
const offSetGateCode = "148861901";
const typeSpell = 0x2;
const typeContinuous = 0x20000;
const setVirtualWorldGate = 0x1150;
const setVirtualWorld = 0x150;

describe.skipIf(!hasUpstreamScripts || !hasKauwloonScript)("Lua real script Virtual World Kauwloon gate place", () => {
  it("restores deck Virtual World Gate selection into MoveToField placement and possible branch metadata", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${kauwloonCode}.lua`);
    expect(script).toContain("e1:SetCategory(CATEGORY_ATKCHANGE+CATEGORY_DECKDES+CATEGORY_SPECIAL_SUMMON)");
    expect(script).toContain("e1:SetCountLimit(1,id,EFFECT_COUNT_CODE_OATH)");
    expect(script).toContain("return c:IsSpellTrap() and c:IsSetCard(SET_VIRTUAL_WORLD_GATE) and not c:IsForbidden() and c:CheckUniqueOnField(tp)");
    expect(script).toContain("if e:GetHandler():IsLocation(LOCATION_HAND) then ft=ft-1 end");
    expect(script).toContain("Duel.SetPossibleOperationInfo(0,CATEGORY_SPECIAL_SUMMON,nil,0,tp,LOCATION_EXTRA)");
    expect(script).toContain("Duel.SetPossibleOperationInfo(0,CATEGORY_DECKDES,nil,0,tp,3)");
    expect(script).toContain("Duel.SelectMatchingCard(tp,s.tffilter,tp,LOCATION_DECK,0,1,1,nil,tp)");
    expect(script).toContain("Duel.MoveToField(tc,tp,tp,LOCATION_SZONE,POS_FACEUP,true)");
    expect(script).toContain("Duel.GetMatchingGroupCount(aux.FaceupFilter(Card.IsSetCard,SET_VIRTUAL_WORLD_GATE),tp,LOCATION_ONFIELD,0,nil)");
    expect(script).toContain("Duel.GetLocationCountFromEx(tp,tp,nil,TYPE_FUSION+TYPE_SYNCHRO+TYPE_XYZ)");
    expect(script).toContain("Duel.GetUsableMZoneCount(tp)");
    expect(script).toContain("Duel.SpecialSummon(rg,0,tp,tp,false,false,POS_FACEUP)");

    const cards: DuelCardData[] = [
      { code: kauwloonCode, name: "Virtual World City - Kauwloon", kind: "spell", typeFlags: typeSpell, setcodes: [setVirtualWorld] },
      { code: gateCode, name: "Virtual World Gate Fixture", kind: "spell", typeFlags: typeSpell | typeContinuous, setcodes: [setVirtualWorldGate] },
      { code: offSetGateCode, name: "Virtual World Non-Gate Decoy", kind: "spell", typeFlags: typeSpell | typeContinuous, setcodes: [setVirtualWorld] },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 14886190, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [kauwloonCode, offSetGateCode, gateCode] }, 1: { main: [] } });
    startDuel(session);

    const kauwloon = requireCard(session, kauwloonCode);
    const gate = requireCard(session, gateCode);
    const decoy = requireCard(session, offSetGateCode);
    moveDuelCard(session.state, kauwloon.uid, "hand", 0);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(kauwloonCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const action = getLuaRestoreLegalActions(restoredOpen, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === kauwloon.uid);
    expect(action, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredOpen, action!);
    expect(restoredOpen.session.state.chain).toEqual([]);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === kauwloon.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.rule,
      reasonPlayer: 0,
    });
    expect(restoredOpen.session.state.cards.find((card) => card.uid === gate.uid)).toMatchObject({
      location: "spellTrapZone",
      controller: 0,
      faceUp: true,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: kauwloon.uid,
      reasonEffectId: 1,
    });
    expect(restoredOpen.session.state.cards.find((card) => card.uid === decoy.uid)).toMatchObject({ location: "deck", controller: 0 });
    expect(restoredOpen.session.state.chain.flatMap((link) => link.operationInfos ?? [])).toEqual([]);
    expect(restoredOpen.session.state.eventHistory.filter((event) => event.eventName === "moved" && event.eventCardUid === gate.uid)).toEqual([
      {
        eventName: "moved",
        eventCode: 1030,
        eventCardUid: gate.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: kauwloon.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "spellTrapZone", position: "faceDown", sequence: 1 },
      },
    ]);
    expect(restoredOpen.session.state.eventHistory.filter((event) => event.eventName === "chainSolved")).toEqual([
      {
        eventName: "chainSolved",
        eventCode: 1022,
        eventPlayer: 0,
        eventValue: 1,
        eventReasonPlayer: 0,
        relatedEffectId: 1,
        eventChainDepth: 1,
        eventChainLinkId: "chain-2",
      },
    ]);
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

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: PlayerId): void {
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
