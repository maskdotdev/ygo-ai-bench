import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { addDuelCardCounter, getDuelCardCounter } from "#duel/counters.js";
import { createDuel, destroyDuelCard, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const limitCode = "86607583";
const codeTalkerCode = "866075830";
const cyberseLinkOneCode = "866075831";
const cyberseLinkTwoCode = "866075832";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasLimitScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${limitCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeLink = 0x4000000;
const raceCyberse = 0x1000000;
const attributeDark = 0x20;
const setCodeTalker = 0x101;
const counterLimit = 0x47;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasLimitScript)("Lua real script Limit Code counter equip summon", () => {
  it("restores established equip relation and leave-field Code Talker destruction", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${limitCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards(workspace));
    const restoredOpen = createRestoredOpenState(reader, workspace);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);

    const limit = requireCard(restoredOpen.session, limitCode);
    const codeTalker = requireCard(restoredOpen.session, codeTalkerCode);
    expect(getDuelCardCounter(findCard(restoredOpen.session, limit.uid), counterLimit)).toBe(2);
    expect(findCard(restoredOpen.session, limit.uid)).toMatchObject({
      controller: 0,
      equippedToUid: codeTalker.uid,
      faceUp: true,
      location: "spellTrapZone",
    });
    expect(findCard(restoredOpen.session, codeTalker.uid)).toMatchObject({
      controller: 0,
      faceUp: true,
      location: "monsterZone",
      position: "faceUpAttack",
      summonType: "special",
    });
    const restoredLeaveField = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredLeaveField);
    destroyDuelCard(restoredLeaveField.session.state, limit.uid, 0, duelReason.effect | duelReason.destroy, 0);
    expect(findCard(restoredLeaveField.session, limit.uid)).toMatchObject({ location: "graveyard", previousEquippedToUid: codeTalker.uid });
    expect(findCard(restoredLeaveField.session, codeTalker.uid)).toMatchObject({
      location: "graveyard",
      previousLocation: "monsterZone",
      reason: duelReason.effect | duelReason.destroy,
      reasonCardUid: limit.uid,
      reasonEffectId: 3,
    });
  });
});

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const limit = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === limitCode);
  expect(limit).toBeDefined();
  return [
    limit!,
    { code: codeTalkerCode, name: "Limit Code Fixture Code Talker", kind: "extra", typeFlags: typeMonster | typeEffect | typeLink, race: raceCyberse, attribute: attributeDark, setcodes: [setCodeTalker], level: 3, attack: 2300, defense: 0, linkMarkers: 0x20 },
    { code: cyberseLinkOneCode, name: "Limit Code Cyberse Link One", kind: "extra", typeFlags: typeMonster | typeEffect | typeLink, race: raceCyberse, attribute: attributeDark, level: 1, attack: 1000, defense: 0, linkMarkers: 0x20 },
    { code: cyberseLinkTwoCode, name: "Limit Code Cyberse Link Two", kind: "extra", typeFlags: typeMonster | typeEffect | typeLink, race: raceCyberse, attribute: attributeDark, level: 1, attack: 1000, defense: 0, linkMarkers: 0x20 },
  ];
}

function createRestoredOpenState(reader: ReturnType<typeof createCardReader>, workspace: ReturnType<typeof createUpstreamNodeWorkspace>): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 86607583, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [limitCode], extra: [codeTalkerCode, cyberseLinkOneCode, cyberseLinkTwoCode] }, 1: { main: [] } });
  startDuel(session);
  const limit = moveDuelCard(session.state, requireCard(session, limitCode).uid, "spellTrapZone", 0);
  const codeTalker = moveDuelCard(session.state, requireCard(session, codeTalkerCode).uid, "monsterZone", 0);
  limit.faceUp = true;
  limit.position = "faceUpAttack";
  limit.equippedToUid = codeTalker.uid;
  limit.cardTargetUids = [codeTalker.uid];
  expect(addDuelCardCounter(limit, counterLimit, 2)).toBe(true);
  codeTalker.faceUp = true;
  codeTalker.position = "faceUpAttack";
  codeTalker.summonType = "special";
  moveDuelCard(session.state, requireCard(session, cyberseLinkOneCode).uid, "graveyard", 0);
  moveDuelCard(session.state, requireCard(session, cyberseLinkTwoCode).uid, "graveyard", 0);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  registerLimitCode(session, workspace);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function registerLimitCode(session: DuelSession, workspace: ReturnType<typeof createUpstreamNodeWorkspace>): void {
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(limitCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Limit Code");
  expect(script).toContain("c:EnableCounterPermit(0x47)");
  expect(script).toContain("e1:SetCategory(CATEGORY_SPECIAL_SUMMON+CATEGORY_COUNTER+CATEGORY_EQUIP)");
  expect(script).toContain("e1:SetCountLimit(1,id,EFFECT_COUNT_CODE_OATH+EFFECT_COUNT_CODE_DUEL)");
  expect(script).toContain("e2:SetCode(EVENT_LEAVE_FIELD)");
  expect(script).toContain("e3:SetCode(EVENT_PHASE+PHASE_END)");
  expect(script).toContain("Duel.GetChainInfo(0,CHAININFO_CHAIN_ID)");
  expect(script).toContain("e2:SetCode(EVENT_CHAIN_DISABLED)");
  expect(script).toContain("return c:IsSetCard(SET_CODE_TALKER) and c:IsCanBeSpecialSummoned(e,0,tp,false,false,POS_FACEUP) and Duel.GetLocationCountFromEx(tp,tp,nil,c)>0");
  expect(script).toContain("return c:IsRace(RACE_CYBERSE) and c:IsLinkMonster()");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_COUNTER,nil,ct,0,0x47)");
  expect(script).toContain("Duel.SpecialSummonStep(tc,0,tp,tp,false,false,POS_FACEUP)");
  expect(script).toContain("Duel.Equip(tp,c,tc)");
  expect(script).toContain("e1:SetCode(EFFECT_EQUIP_LIMIT)");
  expect(script).toContain("Duel.SpecialSummonComplete()");
  expect(script).toContain("Duel.Destroy(tc,REASON_EFFECT)");
  expect(script).toContain("c:RemoveCounter(tp,0x47,1,REASON_EFFECT)");
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
  const waitingFor = response.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}
