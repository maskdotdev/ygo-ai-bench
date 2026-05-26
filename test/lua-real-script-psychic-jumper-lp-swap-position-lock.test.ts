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
const jumperCode = "52430902";
const ownPsychicCode = "524309020";
const opponentTargetCode = "524309021";
const ownNonPsychicCode = "524309022";
const responderCode = "524309023";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasJumperScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${jumperCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const racePsychic = 0x100000;
const raceWarrior = 0x1;
const attributeEarth = 0x1;
const categoryControl = 0x2000;
const effectFlagCardTarget = 0x10;
const effectCannotChangePosition = 14;

describe.skipIf(!hasUpstreamScripts || !hasJumperScript)("Lua real script Psychic Jumper LP swap position lock", () => {
  it("restores LP-cost dual targets into SwapControl and position-change locks", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${jumperCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards());
    const session = createDuel({ seed: 52430902, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, {
      0: { main: [jumperCode, ownPsychicCode, ownNonPsychicCode] },
      1: { main: [opponentTargetCode, responderCode] },
    });
    startDuel(session);

    const jumper = requireCard(session, jumperCode);
    const ownPsychic = requireCard(session, ownPsychicCode);
    const opponentTarget = requireCard(session, opponentTargetCode);
    const ownNonPsychic = requireCard(session, ownNonPsychicCode);
    const responder = requireCard(session, responderCode);
    moveFaceUpAttack(session, jumper, 0, 0);
    moveFaceUpAttack(session, ownPsychic, 0, 1);
    moveFaceUpAttack(session, ownNonPsychic, 0, 2);
    moveFaceUpAttack(session, opponentTarget, 1, 0);
    moveDuelCard(session.state, responder.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(jumperCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === jumper.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      countLimit: effect.countLimit,
      event: effect.event,
      property: effect.property,
      range: effect.range,
    }))).toEqual([
      { category: categoryControl, code: undefined, countLimit: 1, event: "ignition", property: effectFlagCardTarget, range: ["monsterZone"] },
    ]);

    const activate = getLuaRestoreLegalActions(restoredOpen, 0).find((action) =>
      action.type === "activateEffect" && action.uid === jumper.uid
    );
    expect(activate, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, activate!);
    expect(restoredOpen.session.state.players[0].lifePoints).toBe(7000);
    expect(restoredOpen.session.state.chain.map((link) => ({
      operationInfos: link.operationInfos,
      player: link.player,
      sourceUid: link.sourceUid,
      targetUids: link.targetUids,
    }))).toEqual([
      {
        operationInfos: [{ category: categoryControl, targetUids: [ownPsychic.uid, opponentTarget.uid], count: 2, player: 0, parameter: 0 }],
        player: 0,
        sourceUid: jumper.uid,
        targetUids: [ownPsychic.uid, opponentTarget.uid],
      },
    ]);
    expect(restoredOpen.session.state.eventHistory.filter((event) => event.eventName === "lifePointCostPaid")).toEqual([
      {
        eventName: "lifePointCostPaid",
        eventCode: 1201,
        eventPlayer: 0,
        eventValue: 1000,
        eventReason: duelReason.cost,
        eventReasonPlayer: 0,
        eventReasonCardUid: jumper.uid,
        eventReasonEffectId: 1,
      },
    ]);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, 1);
    const pass = getLuaRestoreLegalActions(restoredChain, 1).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restoredChain, 1), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredChain, pass!);

    expect(findCard(restoredChain.session, ownPsychic.uid)).toMatchObject({
      location: "monsterZone",
      controller: 1,
      previousController: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: jumper.uid,
      reasonEffectId: 1,
    });
    expect(findCard(restoredChain.session, opponentTarget.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      previousController: 1,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: jumper.uid,
      reasonEffectId: 1,
    });
    expect(findCard(restoredChain.session, ownNonPsychic.uid)).toMatchObject({ controller: 0, location: "monsterZone" });
    expect(restoredChain.host.messages).not.toContain("psychic jumper responder resolved");
    expect(restoredChain.session.state.effects.filter((effect) =>
      [ownPsychic.uid, opponentTarget.uid].includes(effect.sourceUid) && effect.code === effectCannotChangePosition
    ).map((effect) => ({
      code: effect.code,
      event: effect.event,
      sourceUid: effect.sourceUid,
      value: effect.value,
    })).sort((a, b) => a.sourceUid.localeCompare(b.sourceUid))).toEqual([
      { code: effectCannotChangePosition, event: "continuous", sourceUid: ownPsychic.uid, value: undefined },
      { code: effectCannotChangePosition, event: "continuous", sourceUid: opponentTarget.uid, value: undefined },
    ].sort((a, b) => a.sourceUid.localeCompare(b.sourceUid)));
    expect(restoredChain.session.state.eventHistory.filter((event) => event.eventName === "controlChanged" && event.eventUids?.includes(ownPsychic.uid))).toEqual([
      expect.objectContaining({
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: jumper.uid,
        eventReasonEffectId: 1,
        eventUids: [ownPsychic.uid, opponentTarget.uid],
      }),
    ]);
  });
});

function cards(): DuelCardData[] {
  return [
    { code: jumperCode, name: "Psychic Jumper", kind: "monster", typeFlags: typeMonster | typeEffect, race: racePsychic, attribute: attributeEarth, level: 2, attack: 100, defense: 1500 },
    { code: ownPsychicCode, name: "Psychic Jumper Own Psychic Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: racePsychic, attribute: attributeEarth, level: 4, attack: 1600, defense: 1000 },
    { code: opponentTargetCode, name: "Psychic Jumper Opponent Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1800, defense: 1200 },
    { code: ownNonPsychicCode, name: "Psychic Jumper Own Non-Psychic Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1400, defense: 1400 },
    { code: responderCode, name: "Psychic Jumper Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, race: racePsychic, attribute: attributeEarth, level: 4, attack: 1000, defense: 1000 },
  ];
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Psychic Jumper");
  expect(script).toContain("e1:SetCategory(CATEGORY_CONTROL)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET)");
  expect(script).toContain("e1:SetCost(Cost.PayLP(1000))");
  expect(script).toContain("return c:IsFaceup() and c:IsRace(RACE_PSYCHIC) and c:GetCode()~=id and c:IsAbleToChangeControler()");
  expect(script).toContain("return c:IsFaceup() and c:IsAbleToChangeControler()");
  expect(script).toContain("Duel.SelectTarget(tp,s.filter1,tp,LOCATION_MZONE,0,1,1,nil)");
  expect(script).toContain("Duel.SelectTarget(tp,s.filter2,tp,0,LOCATION_MZONE,1,1,nil)");
  expect(script).toContain("Duel.GetChainInfo(0,CHAININFO_TARGET_CARDS)");
  expect(script).toContain("Duel.SwapControl(tc1,tc2)");
  expect(script).toContain("e1:SetCode(EFFECT_CANNOT_CHANGE_POSITION)");
}

function chainResponderScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_QUICK_O)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetRange(LOCATION_HAND)
      e:SetCondition(function(e,tp) return Duel.GetCurrentChain()>0 end)
      e:SetOperation(function(e,tp) Debug.Message("psychic jumper responder resolved") end)
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

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, controller: PlayerId, sequence: number): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", controller);
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
