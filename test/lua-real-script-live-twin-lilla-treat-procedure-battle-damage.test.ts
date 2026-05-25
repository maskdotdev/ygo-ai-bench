import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const treatCode = "81078880";
const kisikilCode = "810788800";
const offSetCode = "810788801";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasTreatScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${treatCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const attributeDark = 0x20;
const raceCyberse = 0x1000000;
const setKiSikil = 0x153;
const setEvilTwin = 0x155;

describe.skipIf(!hasUpstreamScripts || !hasTreatScript)("Lua real script Live Twin Lil-la Treat procedure battle damage", () => {
  it("restores Ki-sikil hand procedure and grave battle-damage target trigger metadata", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${treatCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards());
    const source = { readScript(name: string) { return workspace.readScript(name) ?? ""; } };

    const blocked = createRestoredTreatWindow({ reader, source, workspace, fieldCase: "offSet" });
    expectCleanRestore(blocked);
    expectRestoredLegalActions(blocked, 0);
    expect(getLuaRestoreLegalActions(blocked, 0).some((action) => action.type === "specialSummonProcedure")).toBe(false);

    const restored = createRestoredTreatWindow({ reader, source, workspace, fieldCase: "valid" });
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 0);
    const treat = requireCard(restored.session, treatCode);
    expect(restored.session.state.effects.filter((effect) => effect.sourceUid === treat.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      event: effect.event,
      property: effect.property,
      range: effect.range,
      sourceUid: effect.sourceUid,
      triggerEvent: effect.triggerEvent,
    }))).toEqual([
      { category: undefined, code: 34, event: "summonProcedure", property: 262144, range: ["hand"], sourceUid: treat.uid, triggerEvent: undefined },
      { category: 2097152, code: 1143, event: "trigger", property: 16, range: ["graveyard"], sourceUid: treat.uid, triggerEvent: "battleDamageDealt" },
    ]);
    const procedure = getLuaRestoreLegalActions(restored, 0).find((action) => action.type === "specialSummonProcedure" && action.uid === treat.uid);
    expect(procedure, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toMatchObject({
      label: "Special Summon Live Twin Lil-la Treat",
      windowKind: "open",
    });
    const result = applyLuaRestoreResponse(restored, procedure as DuelAction);
    expect(result.ok, result.error).toBe(true);
    expect(restored.session.state.cards.find((card) => card.uid === treat.uid)).toMatchObject({
      controller: 0,
      faceUp: true,
      location: "monsterZone",
      position: "faceUpAttack",
      summonType: "special",
    });
  });
});

function createRestoredTreatWindow({
  reader,
  source,
  workspace,
  fieldCase,
}: {
  reader: ReturnType<typeof createCardReader>;
  source: { readScript(name: string): string };
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
  fieldCase: "valid" | "offSet";
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 81078880, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [treatCode, kisikilCode, offSetCode] }, 1: { main: [] } });
  startDuel(session);
  const treat = requireCard(session, treatCode);
  const fieldMonster = requireCard(session, fieldCase === "valid" ? kisikilCode : offSetCode);
  moveDuelCard(session.state, treat.uid, "hand", 0);
  const movedFieldMonster = moveDuelCard(session.state, fieldMonster.uid, "monsterZone", 0);
  movedFieldMonster.faceUp = true;
  movedFieldMonster.position = "faceUpAttack";
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(treatCode), source).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
}

function cards(): DuelCardData[] {
  return [
    liveTwin(treatCode, "Live Twin Lil-la Treat", [setEvilTwin], 500),
    liveTwin(kisikilCode, "Live Twin Ki-sikil Fixture", [setKiSikil], 1100),
    liveTwin(offSetCode, "Live Twin Off-Set Fixture", [0x123], 1100),
  ];
}

function liveTwin(code: string, name: string, setcodes: number[], attack: number): DuelCardData {
  return {
    code,
    name,
    kind: "monster",
    typeFlags: typeMonster | typeEffect,
    race: raceCyberse,
    attribute: attributeDark,
    setcodes,
    level: 2,
    attack,
    defense: 0,
  };
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Live☆Twin Lil-la Treat");
  expect(script).toContain("e1:SetCode(EFFECT_SPSUMMON_PROC)");
  expect(script).toContain("Duel.IsExistingMatchingCard(aux.FaceupFilter(Card.IsSetCard,SET_KI_SIKIL),e:GetHandlerPlayer(),LOCATION_MZONE,0,1,nil)");
  expect(script).toContain("e2:SetCode(EVENT_BATTLE_DAMAGE)");
  expect(script).toContain("e2:SetCost(Cost.SelfBanish)");
  expect(script).toContain("Duel.GetBattleDamage(tp)");
  expect(script).toContain("Duel.SelectTarget(tp,Card.IsFaceup,tp,0,LOCATION_MZONE,1,1,nil)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
}

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
