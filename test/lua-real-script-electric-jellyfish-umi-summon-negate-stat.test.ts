import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack, currentDefense } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const jellyfishCode = "95824983";
const umiCode = "22702055";
const waterSummonCode = "958249830";
const opponentSpellCode = "958249831";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasJellyfishScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${jellyfishCode}.lua`));
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeEffect = 0x20;
const typeField = 0x80000;
const attributeWater = 0x2;

describe.skipIf(!hasUpstreamScripts || !hasJellyfishScript)("Lua real script Electric Jellyfish Umi summon negate stat", () => {
  it("restores Umi cost Special Summon and Umi-gated chain negate into optional ATK/DEF gain", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${jellyfishCode}.lua`);
    expect(script).toContain("return c:IsCode(CARD_UMI) and c:IsAbleToGraveAsCost()");
    expect(script).toContain("Duel.GetMZoneCount(tp,c)>0");
    expect(script).toContain("Duel.SelectMatchingCard(tp,s.spcostfilter,tp,LOCATION_HAND|LOCATION_DECK|LOCATION_ONFIELD,0,1,1,nil,tp)");
    expect(script).toContain("Duel.SendtoGrave(g,REASON_COST)");
    expect(script).toContain("return c:IsAttribute(ATTRIBUTE_WATER) and c:IsCanBeSpecialSummoned(e,0,tp,false,false)");
    expect(script).toContain("Duel.SpecialSummon(g,0,tp,tp,false,false,POS_FACEUP)");
    expect(script).toContain("Duel.IsChainDisablable(ev)");
    expect(script).toContain("Duel.IsEnvironment(CARD_UMI)");
    expect(script).toContain("Duel.NegateEffect(ev)");
    expect(script).toContain("Duel.SelectYesNo(tp,aux.Stringid(id,2))");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e2:SetCode(EFFECT_UPDATE_DEFENSE)");

    const cards: DuelCardData[] = [
      { code: jellyfishCode, name: "Electric Jellyfish", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1400, defense: 1700, attribute: attributeWater },
      { code: umiCode, name: "Umi Cost", kind: "spell", typeFlags: typeSpell | typeField },
      { code: waterSummonCode, name: "Electric Jellyfish WATER Summon", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1500, defense: 1200, attribute: attributeWater },
      { code: opponentSpellCode, name: "Electric Jellyfish Opponent Spell", kind: "spell", typeFlags: typeSpell },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 95824983, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [jellyfishCode, umiCode, umiCode, waterSummonCode] }, 1: { main: [opponentSpellCode] } });
    startDuel(session);

    const jellyfish = requireCard(session, jellyfishCode);
    const waterSummon = requireCard(session, waterSummonCode);
    const opponentSpell = requireCard(session, opponentSpellCode);
    const [umiCost, umiField] = session.state.cards.filter((card) => card.code === umiCode);
    expect(umiCost).toBeDefined();
    expect(umiField).toBeDefined();
    moveFaceUpAttack(session, jellyfish, 0);
    moveDuelCard(session.state, umiCost!.uid, "hand", 0);
    moveDuelCard(session.state, waterSummon.uid, "hand", 0);
    moveDuelCard(session.state, opponentSpell.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${opponentSpellCode}.lua`) return opponentSpellScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(jellyfishCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(opponentSpellCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const summon = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === jellyfish.uid);
    expect(summon, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, summon!);
    passRestoredChain(restoredOpen);

    expect(restoredOpen.session.state.cards.find((card) => card.uid === umiCost!.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: jellyfish.uid,
      reasonEffectId: 1,
    });
    expect(restoredOpen.session.state.cards.find((card) => card.uid === waterSummon.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: jellyfish.uid,
      reasonEffectId: 1,
    });
    expect(restoredOpen.session.state.eventHistory.filter((event) => ["sentToGraveyard", "specialSummoned"].includes(event.eventName))).toEqual([
      {
        eventName: "sentToGraveyard",
        eventCode: 1014,
        eventCardUid: umiCost!.uid,
        eventReason: duelReason.cost,
        eventReasonPlayer: 0,
        eventReasonCardUid: jellyfish.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
      },
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: waterSummon.uid,
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventReasonCardUid: jellyfish.uid,
        eventReasonEffectId: 1,
        eventUids: [waterSummon.uid],
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 1 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 1 },
      },
    ]);

    const restoredUmi = moveDuelCard(restoredOpen.session.state, umiField!.uid, "spellTrapZone", 0);
    restoredUmi.faceUp = true;
    restoredOpen.session.state.turnPlayer = 1;
    restoredOpen.session.state.waitingFor = 1;
    const restoredSpellOpen = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader, { promptOverrides: [{ api: "SelectYesNo", player: 0, returned: true }] });
    expectCleanRestore(restoredSpellOpen);
    expectRestoredLegalActions(restoredSpellOpen, 1);
    const spell = getLuaRestoreLegalActions(restoredSpellOpen, 1).find((action) => action.type === "activateEffect" && action.uid === opponentSpell.uid);
    expect(spell, JSON.stringify(getLuaRestoreLegalActions(restoredSpellOpen, 1), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSpellOpen, spell!);

    const restoredResponse = restoreDuelWithLuaScripts(serializeDuel(restoredSpellOpen.session), source, reader, { promptOverrides: [{ api: "SelectYesNo", player: 0, returned: true }] });
    expectCleanRestore(restoredResponse);
    expectRestoredLegalActions(restoredResponse, 0);
    const negate = getLuaRestoreLegalActions(restoredResponse, 0).find((action) => action.type === "activateEffect" && action.uid === jellyfish.uid);
    expect(negate, JSON.stringify(getLuaRestoreLegalActions(restoredResponse, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredResponse, negate!);
    passRestoredChain(restoredResponse);

    expect(restoredResponse.host.messages).not.toContain("electric jellyfish opponent spell resolved");
    expect(restoredResponse.host.promptDecisions.filter((prompt) => prompt.api === "SelectYesNo")).toEqual([
      { id: "lua-prompt-1", api: "SelectYesNo", player: 0, description: 1533199730, returned: true },
    ]);
    expect(currentAttack(restoredResponse.session.state.cards.find((card) => card.uid === jellyfish.uid), restoredResponse.session.state)).toBe(2000);
    expect(currentDefense(restoredResponse.session.state.cards.find((card) => card.uid === jellyfish.uid), restoredResponse.session.state)).toBe(2300);
    expect(restoredResponse.session.state.eventHistory.filter((event) => ["chainNegated", "chainDisabled"].includes(event.eventName))).toEqual([
      {
        eventName: "chainNegated",
        eventCode: 1024,
        eventPlayer: 1,
        eventValue: 1,
        eventReasonPlayer: 1,
        eventChainDepth: 1,
        eventChainLinkId: "chain-6",
        relatedEffectId: 3,
      },
      {
        eventName: "chainDisabled",
        eventCode: 1025,
        eventPlayer: 1,
        eventValue: 1,
        eventReasonPlayer: 1,
        eventChainDepth: 1,
        eventChainLinkId: "chain-6",
        relatedEffectId: 3,
      },
    ]);
    expect(restoredResponse.session.state.effects.filter((effect) => effect.sourceUid === jellyfish.uid && [100, 101].includes(effect.code ?? -1)).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      value: effect.value,
    }))).toEqual([
      { code: 100, reset: { flags: 33492992 }, value: 600 },
    ]);
    expect(restoredResponse.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function opponentSpellScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_ACTIVATE)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetOperation(function(e,tp) Debug.Message("electric jellyfish opponent spell resolved") end)
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
