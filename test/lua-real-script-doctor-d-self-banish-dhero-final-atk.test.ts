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
const doctorCode = "32671443";
const lowHeroCode = "326714430";
const highHeroCode = "326714431";
const offSetCode = "326714432";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasDoctorScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${doctorCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeSpell = 0x2;
const setDestinyHero = 0xc008;

describe.skipIf(!hasUpstreamScripts || !hasDoctorScript)("Lua real script Doctor D self-banish D-HERO final ATK", () => {
  it("restores grave Cost.SelfBanish into targeting two Destiny HERO monsters and copying ATK", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${doctorCode}.lua`));
    const reader = createCardReader(cards());
    const session = createDoctorSession(reader, workspace);
    const doctor = requireCard(session, doctorCode);
    const lowHero = requireCard(session, lowHeroCode);
    const highHero = requireCard(session, highHeroCode);
    const offSet = requireCard(session, offSetCode);
    moveDuelCard(session.state, doctor.uid, "graveyard", 0);
    doctor.faceUp = true;
    moveFaceUpAttack(session, lowHero, 0);
    moveFaceUpAttack(session, highHero, 0);
    moveFaceUpAttack(session, offSet, 0);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const activation = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === doctor.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, activation!);
    resolveRestoredChain(restoredOpen);

    expect(restoredOpen.session.state.cards.find((card) => card.uid === doctor.uid)).toMatchObject({
      location: "banished",
      controller: 0,
      faceUp: true,
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: doctor.uid,
      reasonEffectId: 2,
    });
    expect(currentAttack(restoredOpen.session.state.cards.find((card) => card.uid === lowHero.uid), restoredOpen.session.state)).toBe(2500);
    expect(currentAttack(restoredOpen.session.state.cards.find((card) => card.uid === highHero.uid), restoredOpen.session.state)).toBe(2500);
    expect(currentAttack(restoredOpen.session.state.cards.find((card) => card.uid === offSet.uid), restoredOpen.session.state)).toBe(3000);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === lowHero.uid && effect.code === 102).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([{ code: 102, reset: { flags: 33427456 }, sourceUid: lowHero.uid, value: 2500 }]);
    expect(restoredOpen.session.state.eventHistory.filter((event) => event.eventName === "banished" || event.eventName === "becameTarget")).toEqual([
      {
        eventName: "banished",
        eventCode: 1011,
        eventCardUid: doctor.uid,
        eventReason: duelReason.cost,
        eventReasonPlayer: 0,
        eventReasonCardUid: doctor.uid,
        eventReasonEffectId: 2,
        eventPreviousState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "banished", position: "faceDown", sequence: 0 },
      },
      {
        eventName: "becameTarget",
        eventCode: 1028,
        eventValue: 1,
        eventCardUid: lowHero.uid,
        eventReason: 0,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 3 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        relatedEffectId: 2,
        eventChainDepth: 1,
        eventChainLinkId: "chain-3",
      },
      {
        eventName: "becameTarget",
        eventCode: 1028,
        eventValue: 1,
        eventCardUid: highHero.uid,
        eventReason: 0,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 1 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 1 },
        relatedEffectId: 2,
        eventChainDepth: 1,
        eventChainLinkId: "chain-3",
      },
    ]);
    expect(restoredOpen.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });

    const restoredStat = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredStat);
    expectRestoredLegalActions(restoredStat, 0);
    expect(currentAttack(restoredStat.session.state.cards.find((card) => card.uid === lowHero.uid), restoredStat.session.state)).toBe(2500);
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("e1:SetCategory(CATEGORY_TOHAND+CATEGORY_SPECIAL_SUMMON)");
  expect(script).toContain("aux.NecroValleyFilter(s.filter)");
  expect(script).toContain("aux.ToHandOrElse(tc,tp,function(c)");
  expect(script).toContain("e2:SetCategory(CATEGORY_ATKCHANGE)");
  expect(script).toContain("e2:SetRange(LOCATION_GRAVE)");
  expect(script).toContain("e2:SetCost(Cost.SelfBanish)");
  expect(script).toContain("Duel.SelectTarget(tp,s.atkfilter1,tp,LOCATION_MZONE,0,1,1,nil,tp)");
  expect(script).toContain("Duel.SelectTarget(tp,s.atkfilter2,tp,LOCATION_MZONE,0,1,1,g1,g1:GetFirst():GetAttack())");
  expect(script).toContain("local g=Duel.GetTargetCards(e):Filter(Card.IsFaceup,nil)");
  expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK_FINAL)");
}

function cards(): DuelCardData[] {
  return [
    { code: doctorCode, name: "Doctor D", kind: "spell", typeFlags: typeSpell },
    { code: lowHeroCode, name: "Doctor D Low Destiny HERO", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setDestinyHero], level: 4, attack: 1000, defense: 1000 },
    { code: highHeroCode, name: "Doctor D High Destiny HERO", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setDestinyHero], level: 4, attack: 2500, defense: 1000 },
    { code: offSetCode, name: "Doctor D Off-Set Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [0x123], level: 4, attack: 3000, defense: 1000 },
  ];
}

function createDoctorSession(reader: ReturnType<typeof createCardReader>, workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelSession {
  const session = createDuel({ seed: 32671443, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [doctorCode, lowHeroCode, highHeroCode, offSetCode] }, 1: { main: [] } });
  startDuel(session);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(doctorCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return session;
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
