import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const comicReliefCode = "15308295";
const actorCode = "153082950";
const opponentCode = "153082951";
const scriptCode = "153082952";
const typeMonster = 0x1;
const typeEffect = 0x20;
const typePendulum = 0x1000000;
const typeSpell = 0x2;
const setAbyssActor = 0x10ec;
const setAbyssScript = 0x20ec;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Comic Relief swap control destroy", () => {
  it("restores Pendulum-zone SwapControl into self-destroy and control-changed script destruction prompt", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${comicReliefCode}.lua`);
    expect(script).toContain("--Abyss Actor - Comic Relief");
    expect(script).toContain("Pendulum.AddProcedure(c)");
    expect(script).toContain("e1:SetCategory(CATEGORY_CONTROL+CATEGORY_DESTROY)");
    expect(script).toContain("e1:SetType(EFFECT_TYPE_IGNITION)");
    expect(script).toContain("e1:SetRange(LOCATION_PZONE)");
    expect(script).toContain("Duel.SelectTarget(tp,s.ctfilter,tp,LOCATION_MZONE,0,1,1,nil)");
    expect(script).toContain("Duel.SelectTarget(tp,Card.IsAbleToChangeControler,tp,0,LOCATION_MZONE,1,1,nil)");
    expect(script).toContain("Duel.SwapControl(a,b)");
    expect(script).toContain("Duel.BreakEffect()");
    expect(script).toContain("Duel.Destroy(e:GetHandler(),REASON_EFFECT)");
    expect(script).toContain("e3:SetCode(EFFECT_AVOID_BATTLE_DAMAGE)");
    expect(script).toContain("e4:SetCode(EVENT_PHASE|PHASE_STANDBY)");
    expect(script).toContain("Duel.GetControl(c,1-tp)");
    expect(script).toContain("e5:SetCode(EVENT_CONTROL_CHANGED)");
    expect(script).toContain("Duel.SelectYesNo(p,aux.Stringid(id,3))");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === comicReliefCode),
      { code: actorCode, name: "Comic Relief Abyss Actor Target", kind: "monster", typeFlags: typeMonster | typeEffect | typePendulum, setcodes: [setAbyssActor], level: 4, attack: 1600, defense: 1200 },
      { code: opponentCode, name: "Comic Relief Opponent Target", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1800, defense: 1000 },
      { code: scriptCode, name: "Comic Relief Abyss Script", kind: "spell", typeFlags: typeSpell, setcodes: [setAbyssScript] },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 15308295, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [comicReliefCode, actorCode, scriptCode] }, 1: { main: [opponentCode] } });
    startDuel(session);

    const comicRelief = requireCard(session, comicReliefCode);
    const actor = requireCard(session, actorCode);
    const opponent = requireCard(session, opponentCode);
    const abyssScript = requireCard(session, scriptCode);
    const scale = moveDuelCard(session.state, comicRelief.uid, "spellTrapZone", 0);
    scale.faceUp = true;
    scale.position = "faceUpAttack";
    moveFaceUpAttack(session, actor, 0);
    moveFaceUpAttack(session, opponent, 1);
    const setScript = moveDuelCard(session.state, abyssScript.uid, "spellTrapZone", 0);
    setScript.faceUp = false;
    setScript.position = "faceDown";
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace, { promptOverrides: [{ api: "SelectYesNo", player: 0, returned: true }] });
    expect(host.loadCardScript(Number(comicReliefCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader, { promptOverrides: [{ api: "SelectYesNo", player: 0, returned: true }] });
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const action = getLuaRestoreLegalActions(restoredOpen, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === comicRelief.uid);
    expect(action, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, action!);

    const restoredResolved = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader, { promptOverrides: [{ api: "SelectYesNo", player: 0, returned: true }] });
    expectCleanRestore(restoredResolved);
    expectRestoredLegalActions(restoredResolved, 0);
    expect(restoredResolved.session.state.cards.find((card) => card.uid === actor.uid)).toMatchObject({ controller: 1, previousController: 0, location: "monsterZone" });
    expect(restoredResolved.session.state.cards.find((card) => card.uid === opponent.uid)).toMatchObject({ controller: 0, previousController: 1, location: "monsterZone" });
    expect(restoredResolved.session.state.cards.find((card) => card.uid === comicRelief.uid)).toMatchObject({
      controller: 0,
      location: "extraDeck",
      reason: duelReason.effect | duelReason.destroy,
      reasonPlayer: 0,
      reasonCardUid: comicRelief.uid,
    });
    expect(restoredResolved.session.state.pendingTriggers).toEqual([]);
    expect(restoredResolved.host.promptDecisions.filter((prompt) => prompt.api === "SelectYesNo")).toEqual([]);
    expect(restoredResolved.session.state.cards.find((card) => card.uid === abyssScript.uid)).toMatchObject({
      controller: 0,
      location: "spellTrapZone",
      faceUp: false,
    });
    expect(restoredResolved.session.state.eventHistory.filter((event) => ["controlChanged", "destroyed"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      previousController: event.eventPreviousState?.controller,
      currentController: event.eventCurrentState?.controller,
      previousLocation: event.eventPreviousState?.location,
      currentLocation: event.eventCurrentState?.location,
    }))).toEqual([
      { eventName: "controlChanged", eventCardUid: actor.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: comicRelief.uid, eventReasonEffectId: 3, previousController: 0, currentController: 1, previousLocation: "monsterZone", currentLocation: "monsterZone" },
      { eventName: "controlChanged", eventCardUid: opponent.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: comicRelief.uid, eventReasonEffectId: 3, previousController: 1, currentController: 0, previousLocation: "monsterZone", currentLocation: "monsterZone" },
      { eventName: "controlChanged", eventCardUid: actor.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: comicRelief.uid, eventReasonEffectId: 3, previousController: 0, currentController: 1, previousLocation: "monsterZone", currentLocation: "monsterZone" },
      { eventName: "destroyed", eventCardUid: comicRelief.uid, eventReason: duelReason.effect | duelReason.destroy, eventReasonPlayer: 0, eventReasonCardUid: comicRelief.uid, eventReasonEffectId: 3, previousController: 0, currentController: 0, previousLocation: "spellTrapZone", currentLocation: "extraDeck" },
    ]);
  });
});

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: 0 | 1): void {
  moveDuelCard(session.state, card.uid, "monsterZone", player);
  card.faceUp = true;
  card.position = "faceUpAttack";
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

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}
