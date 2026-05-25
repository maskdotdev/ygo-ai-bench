import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const radishCode = "71863024";
const opponentSpecialCode = "718630240";
const opponentNormalCode = "718630241";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasRadishScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${radishCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typePendulum = 0x1000000;
const attributeEarth = 0x10;
const racePlant = 0x4000;

describe.skipIf(!hasUpstreamScripts || !hasRadishScript)("Lua real script Performapal Radish Horse registration procedure", () => {
  it("restores pendulum, hand procedure, and targeted ATK-change metadata", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${radishCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards());
    const source = { readScript(name: string) { return workspace.readScript(name) ?? ""; } };

    const blocked = createRestoredRadishWindow({ reader, source, workspace, opponentSummoned: "normal" });
    expectCleanRestore(blocked);
    expectRestoredLegalActions(blocked, 0);
    expect(getLuaRestoreLegalActions(blocked, 0).some((action) => action.type === "specialSummonProcedure")).toBe(false);

    const restored = createRestoredRadishWindow({ reader, source, workspace, opponentSummoned: "special" });
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 0);
    const radish = requireCard(restored.session, radishCode);
    expect(restored.session.state.effects.filter((effect) => effect.sourceUid === radish.uid).map((effect) => ({
      code: effect.code,
      event: effect.event,
      property: effect.property,
      range: effect.range,
      sourceUid: effect.sourceUid,
    }))).toEqual([
      { code: 320, event: "continuous", property: 263168, range: ["spellTrapZone"], sourceUid: radish.uid },
      { code: 1002, event: "ignition", property: undefined, range: ["hand"], sourceUid: radish.uid },
      { code: undefined, event: "ignition", property: 16, range: ["spellTrapZone"], sourceUid: radish.uid },
      { code: 34, event: "summonProcedure", property: 262144, range: ["hand"], sourceUid: radish.uid },
      { code: undefined, event: "ignition", property: 16, range: ["monsterZone"], sourceUid: radish.uid },
    ]);
    expect(getLuaRestoreLegalActions(restored, 0).find((action) => action.type === "specialSummonProcedure" && action.uid === radish.uid)).toMatchObject({
      label: "Special Summon Performapal Radish Horse",
      windowKind: "open",
    });
  });
});

function createRestoredRadishWindow({
  reader,
  source,
  workspace,
  opponentSummoned,
}: {
  reader: ReturnType<typeof createCardReader>;
  source: { readScript(name: string): string };
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
  opponentSummoned: "normal" | "special";
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 71863024, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [radishCode] }, 1: { main: [opponentSpecialCode, opponentNormalCode] } });
  startDuel(session);
  const radish = requireCard(session, radishCode);
  const opponent = requireCard(session, opponentSummoned === "special" ? opponentSpecialCode : opponentNormalCode);
  moveDuelCard(session.state, radish.uid, "hand", 0);
  const movedOpponent = moveDuelCard(session.state, opponent.uid, "monsterZone", 1);
  movedOpponent.faceUp = true;
  movedOpponent.position = "faceUpAttack";
  movedOpponent.summonType = opponentSummoned;
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(radishCode), source).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
}

function cards(): DuelCardData[] {
  return [
    {
      code: radishCode,
      name: "Performapal Radish Horse",
      kind: "monster",
      typeFlags: typeMonster | typeEffect | typePendulum,
      race: racePlant,
      attribute: attributeEarth,
      level: 4,
      attack: 500,
      defense: 2000,
    },
    monster(opponentSpecialCode, "Radish Opponent Special Summoned Monster"),
    monster(opponentNormalCode, "Radish Opponent Normal Summoned Monster"),
  ];
}

function monster(code: string, name: string): DuelCardData {
  return {
    code,
    name,
    kind: "monster",
    typeFlags: typeMonster | typeEffect,
    race: racePlant,
    attribute: attributeEarth,
    level: 4,
    attack: 1000,
    defense: 1000,
  };
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Performapal Radish Horse");
  expect(script).toContain("Pendulum.AddProcedure(c)");
  expect(script).toContain("e1:SetRange(LOCATION_PZONE)");
  expect(script).toContain("e2:SetCode(EFFECT_SPSUMMON_PROC)");
  expect(script).toContain("Duel.IsExistingMatchingCard(s.filter,tp,0,LOCATION_MZONE,1,nil)");
  expect(script).toContain("Duel.GetFieldGroupCount(tp,LOCATION_MZONE,0)<=Duel.GetFieldGroupCount(tp,0,LOCATION_MZONE)");
  expect(script).toContain("e3:SetRange(LOCATION_MZONE)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e2:SetValue(atk)");
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
