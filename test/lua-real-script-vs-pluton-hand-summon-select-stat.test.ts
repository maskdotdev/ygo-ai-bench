import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentDefense } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const plutonCode = "55688914";
const setVanquishSoul = 0x196;
const allyCode = "556889140";
const fireRevealCode = "556889141";
const typeMonster = 0x1;
const typeEffect = 0x20;
const attributeFire = 0x4;
const attributeDark = 0x20;

describe.skipIf(!hasUpstreamScripts)("Lua real script Vanquish Soul Pluton hand summon SelectEffect stat", () => {
  it("restores opponent-turn hand Quick Summon and reveal-cost SelectEffect DEF boost", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${plutonCode}.lua`);
    expect(script).toContain("e1:SetType(EFFECT_TYPE_QUICK_O)");
    expect(script).toContain("e1:SetRange(LOCATION_HAND)");
    expect(script).toContain("return Duel.IsTurnPlayer(1-tp) and not Duel.IsExistingMatchingCard(s.spconfilter,tp,LOCATION_MMZONE,0,1,nil)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,c,1,0,0)");
    expect(script).toContain("Duel.SpecialSummon(c,0,tp,tp,false,false,POS_FACEUP)");
    expect(script).toContain("e2:SetProperty(EFFECT_FLAG_DAMAGE_STEP)");
    expect(script).toContain("e2:SetCondition(aux.StatChangeDamageStepCondition)");
    expect(script).toContain("Duel.SelectEffect(tp,");
    expect(script).toContain("Duel.ConfirmCards(1-tp,g)");
    expect(script).toContain("Duel.ShuffleHand(tp)");
    expect(script).toContain("c:UpdateDefense(3000,RESETS_STANDARD_DISABLE_PHASE_END)");

    const cards: DuelCardData[] = [
      { code: plutonCode, name: "Vanquish Soul Pluton HG", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setVanquishSoul], attribute: attributeDark, level: 6, attack: 0, defense: 0 },
      { code: allyCode, name: "Vanquish Soul Face-up Ally", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setVanquishSoul], attribute: attributeDark, level: 4, attack: 1500, defense: 1000 },
      { code: fireRevealCode, name: "Vanquish Soul FIRE Reveal", kind: "monster", typeFlags: typeMonster | typeEffect, attribute: attributeFire, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 55688914, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [plutonCode, allyCode, fireRevealCode] }, 1: { main: [] } });
    startDuel(session);

    const pluton = requireCard(session, plutonCode);
    const ally = requireCard(session, allyCode);
    const fireReveal = requireCard(session, fireRevealCode);
    moveDuelCard(session.state, pluton.uid, "hand", 0);
    moveDuelCard(session.state, ally.uid, "monsterZone", 0);
    ally.faceUp = true;
    ally.position = "faceUpAttack";
    moveDuelCard(session.state, fireReveal.uid, "hand", 0);
    session.state.phase = "main1";
    session.state.turnPlayer = 1;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(plutonCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredSummonOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredSummonOpen);
    expectRestoredLegalActions(restoredSummonOpen, 0);
    const summonAction = getLuaRestoreLegalActions(restoredSummonOpen, 0).find((action) => action.type === "activateEffect" && action.uid === pluton.uid);
    expect(summonAction, JSON.stringify(getLuaRestoreLegalActions(restoredSummonOpen, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredSummonOpen, summonAction!);
    expect(restoredSummonOpen.session.state.chain.flatMap((link) => link.operationInfos ?? [])).toEqual([]);

    const restoredSummonChain = restoreDuelWithLuaScripts(serializeDuel(restoredSummonOpen.session), workspace, reader);
    expectCleanRestore(restoredSummonChain);
    expectRestoredLegalActions(restoredSummonChain, restoredSummonChain.session.state.waitingFor ?? restoredSummonChain.session.state.turnPlayer);
    expect(restoredSummonChain.session.state.cards.find((card) => card.uid === pluton.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: pluton.uid,
      reasonEffectId: 1,
    });
    expect(restoredSummonChain.session.state.eventHistory.filter((event) => event.eventName === "specialSummoned")).toEqual([
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: pluton.uid,
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventReasonCardUid: pluton.uid,
        eventReasonEffectId: 1,
        eventUids: [pluton.uid],
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 1 },
      },
    ]);

    restoredSummonChain.session.state.turnPlayer = 0;
    restoredSummonChain.session.state.waitingFor = 0;
    const restoredStatOpen = restoreDuelWithLuaScripts(serializeDuel(restoredSummonChain.session), workspace, reader);
    expectCleanRestore(restoredStatOpen);
    expectRestoredLegalActions(restoredStatOpen, 0);
    const statAction = getLuaRestoreLegalActions(restoredStatOpen, 0).find((action) => action.type === "activateEffect" && action.uid === pluton.uid);
    expect(statAction, JSON.stringify(getLuaRestoreLegalActions(restoredStatOpen, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredStatOpen, statAction!);
    expect(restoredStatOpen.session.state.chain).toEqual([]);
    expect(restoredStatOpen.session.state.chain.flatMap((link) => link.operationInfos ?? [])).toEqual([]);
    expect(restoredStatOpen.host.promptDecisions).toEqual([
      { id: "lua-prompt-1", api: "SelectEffect", player: 0, options: [1], descriptions: [891022626], returned: 1 },
    ]);
    expect(restoredStatOpen.host.messages).toContain(`confirmed 1: ${fireRevealCode}`);
    const boostedPluton = restoredStatOpen.session.state.cards.find((card) => card.uid === pluton.uid);
    expect(currentDefense(boostedPluton, restoredStatOpen.session.state)).toBe(3000);
    expect(boostedPluton).toMatchObject({ defenseModifier: 3000 });
    expect(restoredStatOpen.session.state.eventHistory.filter((event) => event.eventName === "confirmed")).toEqual([
      {
        eventName: "confirmed",
        eventCode: 1211,
        eventCardUid: fireReveal.uid,
        eventPlayer: 1,
        eventReason: 0,
        eventReasonPlayer: 0,
        eventValue: 1,
        eventUids: [fireReveal.uid],
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 1 },
        eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 1 },
      },
    ]);
  });
});

function requireCard(session: DuelSession, code: string): DuelCardInstance {
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
  if (waitingFor !== undefined) {
    expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
    expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
    expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  }
}

function resolveRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  const player = restored.session.state.waitingFor;
  expect(player).toBeDefined();
  const pass = getLuaRestoreLegalActions(restored, player!).find((action) => action.type === "passChain");
  expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player!), null, 2)).toBeDefined();
  applyLuaRestoreAndAssert(restored, pass!);
}
