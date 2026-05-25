import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const headhuntCode = "91781484";
const dddCode = "917814840";
const targetCode = "917814841";
const responderCode = "917814842";
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeFusion = 0x40;
const raceFiend = 0x8;
const raceWarrior = 0x1;
const attributeDark = 0x20;
const attributeEarth = 0x1;
const setDdd = 0x10af;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script D/D/D Headhunt control disable setcode", () => {
  it("restores target control into disable, cannot-attack, D/D/D setcode, and End Phase return effects", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${headhuntCode}.lua`);
    expect(script).toContain("e1:SetCountLimit(1,id,EFFECT_COUNT_CODE_OATH)");
    expect(script).toContain("return Duel.IsExistingMatchingCard(aux.FaceupFilter(Card.IsSetCard,SET_DDD),tp,LOCATION_MZONE,0,1,nil)");
    expect(script).toContain("Duel.SelectTarget(tp,aux.FaceupFilter(Card.IsControlerCanBeChanged),tp,0,LOCATION_MZONE,1,1,nil)");
    expect(script).toContain("Duel.GetControl(tc,tp,PHASE_END,2)");
    expect(script).toContain("e1:SetCode(EFFECT_DISABLE)");
    expect(script).toContain("e2:SetCode(EFFECT_DISABLE_EFFECT)");
    expect(script).toContain("e3:SetCode(EFFECT_CANNOT_ATTACK)");
    expect(script).toContain("tc:IsSpecialSummoned() and tc:IsSummonLocation(LOCATION_EXTRA)");
    expect(script).toContain("e4:SetProperty(EFFECT_FLAG_CLIENT_HINT)");
    expect(script).toContain("e4:SetCode(EFFECT_ADD_SETCODE)");

    const reader = createCardReader(cards(workspace));
    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return responderScript();
        return workspace.readScript(name);
      },
    };
    const session = createDuel({ seed: 91781484, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [headhuntCode, dddCode] }, 1: { main: [responderCode], extra: [targetCode] } });
    startDuel(session);

    const headhunt = requireCard(session, headhuntCode);
    const ddd = requireCard(session, dddCode);
    const target = requireCard(session, targetCode);
    const responder = requireCard(session, responderCode);
    moveDuelCard(session.state, headhunt.uid, "spellTrapZone", 0);
    headhunt.faceUp = false;
    headhunt.position = "faceDown";
    moveFaceUpAttack(session, ddd, 0, 0);
    moveFaceUpAttack(session, target, 1, 0);
    target.summonType = "fusion";
    target.summonLocation = "extraDeck";
    target.previousLocation = "extraDeck";
    moveDuelCard(session.state, responder.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    for (const code of [headhuntCode, responderCode]) expect(host.loadCardScript(Number(code), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const activation = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === headhunt.uid);
    expect(activation, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, activation!);
    expect(session.state.chain[0]).toMatchObject({
      sourceUid: headhunt.uid,
      player: 0,
      targetUids: [target.uid],
      operationInfos: [{ category: 0x2000, targetUids: [target.uid], count: 1, player: 0, parameter: 0 }],
    });

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, 1);
    expect(getLuaRestoreLegalActions(restoredChain, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);

    const pass = getLuaRestoreLegalActions(restoredChain, 1).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    const resolved = applyLuaRestoreResponse(restoredChain, pass!);
    expect(resolved.ok, resolved.error).toBe(true);
    expect(restoredChain.host.messages).not.toContain("headhunt responder resolved");
    expect(restoredChain.session.state.cards.find((card) => card.uid === headhunt.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(restoredChain.session.state.cards.find((card) => card.uid === target.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      previousController: 1,
      summonType: "fusion",
    });
    expect(restoredChain.session.state.eventHistory.filter((event) => event.eventName === "controlChanged" && event.eventCardUid === target.uid)).toEqual([
      {
        eventName: "controlChanged",
        eventCode: 1120,
        eventCardUid: target.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: headhunt.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 1 },
      },
    ]);
    expect(
      restoredChain.session.state.effects.filter((effect) => effect.sourceUid === target.uid && [2, 8, 85, 334].includes(effect.code ?? 0)).map((effect) => ({
        code: effect.code,
        event: effect.event,
        property: effect.property,
        reset: effect.reset,
        value: effect.value,
      })),
    ).toEqual([
      { code: 2, event: "continuous", property: undefined, reset: { flags: 33427456 }, value: undefined },
      { code: 8, event: "continuous", property: undefined, reset: { flags: 33427456 }, value: undefined },
      { code: 85, event: "continuous", property: undefined, reset: { flags: 33427456 }, value: undefined },
      { code: 334, event: "continuous", property: 67108864, reset: { flags: 33427456 }, value: setDdd },
    ]);
    expect(restoredChain.session.state.effects.map((effect) => effect.registryKey)).toContain(`lua:${targetCode}:temporary-control-return:${target.uid}`);
  });
});

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  return [
    ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === headhuntCode),
    { code: dddCode, name: "Headhunt D/D/D Ally", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFiend, attribute: attributeDark, level: 4, attack: 1600, defense: 1000, setcodes: [setDdd] },
    { code: targetCode, name: "Headhunt Extra Deck Target", kind: "extra", typeFlags: typeMonster | typeEffect | typeFusion, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1800, defense: 1200 },
    { code: responderCode, name: "Headhunt Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1000, defense: 1000 },
  ];
}

function responderScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_QUICK_O)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetRange(LOCATION_HAND)
      e:SetCondition(function(e,tp) return Duel.GetCurrentChain()>0 end)
      e:SetOperation(function(e,tp) Debug.Message("headhunt responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  moved.sequence = sequence;
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

function applyAndAssert(session: DuelSession, action: DuelAction) {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  return response;
}
