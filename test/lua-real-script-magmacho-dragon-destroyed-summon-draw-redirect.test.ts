import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, destroyDuelCard, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const magmachoCode = "50951254";
const destroyedFireCode = "509512540";
const drawCode = "509512541";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasMagmachoScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${magmachoCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceDragon = 0x2000;
const attributeFire = 0x4;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasMagmachoScript)("Lua real script Magmacho Dragon destroyed summon draw redirect", () => {
  it("restores destroyed FIRE monster trigger into self Special Summon, redirect registration, BreakEffect, and draw", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${magmachoCode}.lua`);
    expectScriptShape(script);

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === magmachoCode),
      { code: destroyedFireCode, name: "Magmacho Destroyed FIRE", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceDragon, attribute: attributeFire, level: 4, attack: 1500, defense: 1000 },
      { code: drawCode, name: "Magmacho Draw Card", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceDragon, attribute: attributeFire, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 50951254, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [magmachoCode, destroyedFireCode, drawCode] }, 1: { main: [] } });
    startDuel(session);

    const magmacho = requireCard(session, magmachoCode);
    const destroyedFire = requireCard(session, destroyedFireCode);
    const drawCard = requireCard(session, drawCode);
    moveDuelCard(session.state, magmacho.uid, "graveyard", 0);
    const fire = moveDuelCard(session.state, destroyedFire.uid, "monsterZone", 0);
    fire.faceUp = true;
    fire.position = "faceUpAttack";
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(magmachoCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    destroyDuelCard(session.state, destroyedFire.uid, 0, duelReason.effect | duelReason.destroy, 0, "graveyard", { eventReasonCardUid: destroyedFire.uid, eventReasonEffectId: 99 });
    expect(session.state.eventHistory.filter((event) => event.eventName === "destroyed" && event.eventCardUid === destroyedFire.uid)).toEqual([
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: destroyedFire.uid,
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: destroyedFire.uid,
        eventReasonEffectId: 99,
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 1 },
      },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === magmacho.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    expect(trigger).not.toHaveProperty("operationInfos");
    applyLuaRestoreAndAssert(restoredTrigger, trigger!);
    expect(restoredTrigger.session.state.chain).toEqual([]);
    expect(restoredTrigger.session.state.cards.find((card) => card.uid === magmacho.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: magmacho.uid,
      reasonEffectId: 2,
    });
    expect(restoredTrigger.session.state.cards.find((card) => card.uid === drawCard.uid)).toMatchObject({ location: "hand", controller: 0 });
    expect(restoredTrigger.session.state.effects.filter((effect) => effect.sourceUid === magmacho.uid && effect.code === 60)).toEqual([
      expect.objectContaining({
        event: "continuous",
        code: 60,
        property: 0x4000400,
        range: ["monsterZone"],
        reset: { flags: 0xc7a1000 },
        value: 0x20,
      }),
    ]);
    expect(restoredTrigger.session.state.eventHistory.filter((event) => ["specialSummoned", "breakEffect", "cardsDrawn"].includes(event.eventName))).toEqual([
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: magmacho.uid,
        eventUids: [magmacho.uid],
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventReasonCardUid: magmacho.uid,
        eventReasonEffectId: 2,
        eventPreviousState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
      {
        eventName: "breakEffect",
        eventCode: 1050,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: magmacho.uid,
        eventReasonEffectId: 2,
      },
      {
        eventName: "cardsDrawn",
        eventCode: 1110,
        eventPlayer: 0,
        eventValue: 1,
        eventUids: [drawCard.uid],
        eventCardUid: drawCard.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: magmacho.uid,
        eventReasonEffectId: 2,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 1 },
        eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
      },
    ]);

    const restoredRedirect = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), workspace, reader);
    expectCleanRestore(restoredRedirect);
    expectRestoredLegalActions(restoredRedirect, 0);
    destroyDuelCard(restoredRedirect.session.state, magmacho.uid, 0, duelReason.effect | duelReason.destroy, 0);
    expect(restoredRedirect.session.state.cards.find((card) => card.uid === magmacho.uid)).toMatchObject({
      location: "banished",
      reason: duelReason.effect | duelReason.destroy | duelReason.redirect,
      reasonPlayer: 0,
    });
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("e1:SetCategory(CATEGORY_ATKCHANGE)");
  expect(script).toContain("Duel.SelectMatchingCard(tp,s.atkcfilter,tp,LOCATION_GRAVE,0,1,3,nil)");
  expect(script).toContain("c:UpdateAttack(e:GetLabel()*400,RESETS_STANDARD_DISABLE_PHASE_END)");
  expect(script).toContain("e2:SetCategory(CATEGORY_SPECIAL_SUMMON+CATEGORY_DRAW)");
  expect(script).toContain("e2:SetProperty(EFFECT_FLAG_DELAY,EFFECT_FLAG2_CHECK_SIMULTANEOUS)");
  expect(script).toContain("e2:SetCode(EVENT_DESTROYED)");
  expect(script).toContain("c:IsPreviousLocation(LOCATION_MZONE) and c:IsPreviousPosition(POS_FACEUP) and c:IsPreviousControler(tp)");
  expect(script).toContain("c:GetPreviousAttributeOnField()&ATTRIBUTE_FIRE>0 and c:IsReason(REASON_EFFECT)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,c,1,tp,0)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_DRAW,nil,0,tp,1)");
  expect(script).toContain("Duel.SpecialSummon(c,0,tp,tp,false,false,POS_FACEUP)>0");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CANNOT_DISABLE+EFFECT_FLAG_CLIENT_HINT)");
  expect(script).toContain("e1:SetCode(EFFECT_LEAVE_FIELD_REDIRECT)");
  expect(script).toContain("Duel.BreakEffect()");
  expect(script).toContain("Duel.Draw(tp,1,REASON_EFFECT)");
}

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
  const player = response.state.waitingFor as PlayerId | undefined;
  if (player === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, player));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, player));
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
