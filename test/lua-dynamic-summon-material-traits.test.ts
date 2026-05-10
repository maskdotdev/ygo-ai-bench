import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";
import type { DuelCardData, DuelSession } from "#duel/types.js";

describe("Lua dynamic summon material traits", () => {
  it("uses current type effects for restored Synchro legal actions", () => {
    const { session, reader, source, synchroUid, tunerUid, nonTunerUid } = setupDynamicSynchroFixture(101);
    const actions = getDuelLegalActions(session, 0).filter((action) => action.type === "synchroSummon" && action.uid === synchroUid);
    expect(actions).toHaveLength(1);
    expect(actions[0]?.type).toBe("synchroSummon");
    const action = actions[0];
    if (!action || action.type !== "synchroSummon") throw new Error("Expected Synchro Summon action");
    expect(action.materialUids).toEqual(expect.arrayContaining([tunerUid, nonTunerUid]));

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);

    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    const restoredActions = getLuaRestoreLegalActions(restored, 0).filter((action) => action.type === "synchroSummon" && action.uid === synchroUid);
    expect(restoredActions).toHaveLength(1);
    const result = applyLuaRestoreResponse(restored, restoredActions[0]!);
    expect(result.ok, result.error).toBe(true);
    expect(restored.session.state.cards.find((card) => card.uid === synchroUid)).toMatchObject({
      location: "monsterZone",
      summonType: "synchro",
      summonMaterialUids: expect.arrayContaining([tunerUid, nonTunerUid]),
    });
  });

  it("uses current type effects for Lua SynchroSummon default material selection", () => {
    const { session, source, synchroUid, tunerUid, nonTunerUid } = setupDynamicSynchroFixture(102);
    const host = createLuaScriptHost(session, source);
    const result = host.loadScript(
      `
      local sc=Duel.SelectMatchingCard(0,aux.FilterBoolFunction(Card.IsCode,400),0,LOCATION_EXTRA,0,1,1,nil):GetFirst()
      Debug.Message("dynamic default synchro " .. Duel.SynchroSummon(sc))
      `,
      "dynamic-default-synchro.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("dynamic default synchro 1");
    expect(session.state.cards.find((card) => card.uid === synchroUid)).toMatchObject({
      location: "monsterZone",
      summonType: "synchro",
      summonMaterialUids: expect.arrayContaining([tunerUid, nonTunerUid]),
    });
  });

  it("uses current traits for Lua material predicate helpers", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Dynamic Predicate Material", kind: "monster", typeFlags: 0x1, level: 4, race: 0x1, attribute: 0x10 },
      { code: "200", name: "Explicit Non-Tuner", kind: "monster", typeFlags: 0x1, level: 2 },
      { code: "300", name: "Explicit Synchro", kind: "extra", typeFlags: 0x2001, level: 6, synchroMaterials: { tuner: "100", nonTuners: ["200"] } },
      { code: "400", name: "Spellcaster Xyz", kind: "extra", typeFlags: 0x800001, level: 4, xyzMaterialRace: 0x2 },
      { code: "500", name: "Dark Link", kind: "extra", typeFlags: 0x4000001, level: 2, linkMaterialAttribute: 0x20 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 103, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: ["100", "200"], extra: ["300", "400", "500"] }, 1: { main: [] } });
    startDuel(session);
    moveDuelCard(session.state, requireCard(session, "100", "deck").uid, "monsterZone", 0);
    moveDuelCard(session.state, requireCard(session, "200", "deck").uid, "monsterZone", 0);

    const source = { readScript: dynamicMaterialPredicateScript };
    const host = createLuaScriptHost(session, source);
    expect(host.loadCardScript(100, source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const result = host.loadScript(
      `
      local c100=Duel.GetFieldCard(0,LOCATION_MZONE,0)
      local c200=Duel.GetFieldCard(0,LOCATION_MZONE,1)
      local synchro=Duel.GetFieldCard(0,LOCATION_EXTRA,0)
      local xyz=Duel.GetFieldCard(0,LOCATION_EXTRA,1)
      local link=Duel.GetFieldCard(0,LOCATION_EXTRA,2)
      Debug.Message("dynamic predicate traits " .. c100:GetType() .. "/" .. c100:GetRace() .. "/" .. c100:GetAttribute())
      Debug.Message("dynamic material predicates " .. tostring(c100:IsCanBeSynchroMaterial(synchro)) .. "/" .. tostring(c200:IsCanBeSynchroMaterial(synchro)) .. "/" .. tostring(c100:IsCanBeXyzMaterial(xyz)) .. "/" .. tostring(c100:IsCanBeLinkMaterial(link)))
      `,
      "dynamic-material-predicates.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("dynamic predicate traits 4097/2/32");
    expect(host.messages).toContain("dynamic material predicates true/true/true/true");
  });

  it("uses Link-only code and setcode effects for Link material legal actions", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Dynamic Link-Code Material", kind: "monster", typeFlags: 0x1, level: 4 },
      { code: "200", name: "Dynamic Link-Setcode Material", kind: "monster", typeFlags: 0x1, level: 4 },
      { code: "700", name: "Named Link Target", kind: "extra", typeFlags: 0x4000001, level: 1, linkMaterials: ["900"] },
      { code: "800", name: "Setcode Link Target", kind: "extra", typeFlags: 0x4000001, level: 1, linkMaterialSetcode: 0x321 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 105, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: ["100", "200"], extra: ["700", "800"] }, 1: { main: [] } });
    startDuel(session);
    const codeMaterial = requireCard(session, "100", "deck");
    const setcodeMaterial = requireCard(session, "200", "deck");
    const namedLink = requireCard(session, "700", "extraDeck");
    const setcodeLink = requireCard(session, "800", "extraDeck");
    moveDuelCard(session.state, codeMaterial.uid, "monsterZone", 0);
    moveDuelCard(session.state, setcodeMaterial.uid, "monsterZone", 0);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = { readScript: dynamicLinkMaterialTraitScript };
    const host = createLuaScriptHost(session, source);
    expect(host.loadCardScript(100, source).ok).toBe(true);
    expect(host.loadCardScript(200, source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);
    const predicateResult = host.loadScript(
      `
      local c100=Duel.GetFieldCard(0,LOCATION_MZONE,0)
      local c200=Duel.GetFieldCard(0,LOCATION_MZONE,1)
      local named=Duel.GetFieldCard(0,LOCATION_EXTRA,0)
      local setlink=Duel.GetFieldCard(0,LOCATION_EXTRA,1)
      Debug.Message("dynamic link material predicates " .. tostring(c100:IsCanBeLinkMaterial(named)) .. "/" .. tostring(c200:IsCanBeLinkMaterial(setlink)))
      `,
      "dynamic-link-material-predicates.lua",
    );
    expect(predicateResult.ok, predicateResult.error).toBe(true);
    expect(host.messages).toContain("dynamic link material predicates true/true");

    const namedAction = getDuelLegalActions(session, 0).find((action) => action.type === "linkSummon" && action.uid === namedLink.uid);
    expect(namedAction).toMatchObject({ type: "linkSummon", materialUids: [codeMaterial.uid] });
    const setcodeAction = getDuelLegalActions(session, 0).find((action) => action.type === "linkSummon" && action.uid === setcodeLink.uid);
    expect(setcodeAction).toMatchObject({ type: "linkSummon", materialUids: [setcodeMaterial.uid] });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    const restoredNamedAction = getLuaRestoreLegalActions(restored, 0).find((action) => action.type === "linkSummon" && action.uid === namedLink.uid);
    expect(restoredNamedAction).toMatchObject({ type: "linkSummon", materialUids: [codeMaterial.uid] });
    const restoredSetcodeAction = getLuaRestoreLegalActions(restored, 0).find((action) => action.type === "linkSummon" && action.uid === setcodeLink.uid);
    expect(restoredSetcodeAction).toMatchObject({ type: "linkSummon", materialUids: [setcodeMaterial.uid] });
    const response = applyLuaRestoreResponse(restored, restoredNamedAction!);
    expect(response.ok, response.error).toBe(true);
    expect(restored.session.state.cards.find((card) => card.uid === namedLink.uid)).toMatchObject({
      location: "monsterZone",
      summonType: "link",
      summonMaterialUids: [codeMaterial.uid],
    });
  });

  it("uses current code and setcode effects for non-Link summon material legal actions", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Dynamic General Material", kind: "monster", typeFlags: 0x1, level: 4 },
      { code: "200", name: "Static General Material", kind: "monster", typeFlags: 0x1, level: 4, setcodes: [0x321] },
      { code: "300", name: "Dynamic-Code Fusion", kind: "extra", typeFlags: 0x41, fusionMaterials: ["900", "200"] },
      { code: "400", name: "Dynamic-Code Xyz", kind: "extra", typeFlags: 0x800001, level: 4, xyzMaterials: ["900", "200"] },
      { code: "500", name: "Dynamic-Code Synchro", kind: "extra", typeFlags: 0x2001, level: 8, synchroMaterials: { tuner: "900", nonTuners: ["200"] } },
      { code: "600", name: "Dynamic-Code Ritual", kind: "monster", typeFlags: 0x81, level: 8, ritualMaterials: ["900", "200"] },
      { code: "700", name: "Dynamic-Setcode Xyz", kind: "extra", typeFlags: 0x800001, level: 4, xyzMaterialCount: 2, xyzMaterialSetcode: 0x321 },
      { code: "800", name: "Dynamic-Setcode Synchro", kind: "extra", typeFlags: 0x2001, level: 8, synchroTunerSetcode: 0x321, synchroNonTunerSetcode: 0x321 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 106, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: ["100", "200", "600"], extra: ["300", "400", "500", "700", "800"] }, 1: { main: [] } });
    startDuel(session);
    const dynamicMaterial = requireCard(session, "100", "deck");
    const staticMaterial = requireCard(session, "200", "deck");
    const ritual = requireCard(session, "600", "deck");
    const fusion = requireCard(session, "300", "extraDeck");
    const xyz = requireCard(session, "400", "extraDeck");
    const synchro = requireCard(session, "500", "extraDeck");
    const setcodeXyz = requireCard(session, "700", "extraDeck");
    const setcodeSynchro = requireCard(session, "800", "extraDeck");
    moveDuelCard(session.state, dynamicMaterial.uid, "monsterZone", 0);
    moveDuelCard(session.state, staticMaterial.uid, "monsterZone", 0);
    moveDuelCard(session.state, ritual.uid, "hand", 0);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = { readScript: dynamicGeneralMaterialTraitScript };
    const host = createLuaScriptHost(session, source);
    expect(host.loadCardScript(100, source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(host.messages).toContain("dynamic general material true/true/true/true");

    const materialUids = [dynamicMaterial.uid, staticMaterial.uid];
    const actions = getDuelLegalActions(session, 0);
    expect(actions).toContainEqual(expect.objectContaining({ type: "fusionSummon", uid: fusion.uid, materialUids }));
    expect(actions).toContainEqual(expect.objectContaining({ type: "xyzSummon", uid: xyz.uid, materialUids }));
    expect(actions).toContainEqual(expect.objectContaining({ type: "synchroSummon", uid: synchro.uid, materialUids }));
    expect(actions).toContainEqual(expect.objectContaining({ type: "ritualSummon", uid: ritual.uid, materialUids }));
    expect(actions).toContainEqual(expect.objectContaining({ type: "xyzSummon", uid: setcodeXyz.uid, materialUids }));
    expect(actions).toContainEqual(expect.objectContaining({ type: "synchroSummon", uid: setcodeSynchro.uid, materialUids }));

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    const restoredActions = getLuaRestoreLegalActions(restored, 0);
    expect(restoredActions).toContainEqual(expect.objectContaining({ type: "fusionSummon", uid: fusion.uid, materialUids }));
    expect(restoredActions).toContainEqual(expect.objectContaining({ type: "xyzSummon", uid: xyz.uid, materialUids }));
    expect(restoredActions).toContainEqual(expect.objectContaining({ type: "synchroSummon", uid: synchro.uid, materialUids }));
    expect(restoredActions).toContainEqual(expect.objectContaining({ type: "ritualSummon", uid: ritual.uid, materialUids }));
    expect(restoredActions).toContainEqual(expect.objectContaining({ type: "xyzSummon", uid: setcodeXyz.uid, materialUids }));
    expect(restoredActions).toContainEqual(expect.objectContaining({ type: "synchroSummon", uid: setcodeSynchro.uid, materialUids }));
  });

  it("uses current monster type for Lua Fusion material selection and summons", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Material Losing Monster Type", kind: "monster", typeFlags: 0x1, level: 4 },
      { code: "200", name: "Normal Fusion Material", kind: "monster", typeFlags: 0x1, level: 4 },
      { code: "300", name: "Specific Fusion", kind: "extra", typeFlags: 0x41, fusionMaterials: ["100", "200"] },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 104, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: ["100", "200"], extra: ["300"] }, 1: { main: [] } });
    startDuel(session);
    moveDuelCard(session.state, requireCard(session, "100", "deck").uid, "monsterZone", 0);
    moveDuelCard(session.state, requireCard(session, "200", "deck").uid, "monsterZone", 0);

    const source = { readScript: dynamicRemovedMonsterMaterialScript };
    const host = createLuaScriptHost(session, source);
    expect(host.loadCardScript(100, source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const result = host.loadScript(
      `
      local c100=Duel.GetFieldCard(0,LOCATION_MZONE,0)
      local c200=Duel.GetFieldCard(0,LOCATION_MZONE,1)
      local fusion=Duel.GetFieldCard(0,LOCATION_EXTRA,0)
      local pool=Duel.GetFusionMaterial(0)
      local selected=Duel.SelectFusionMaterial(0,fusion,Group.FromCards(c100,c200),0)
      Debug.Message("dynamic removed fusion pool " .. tostring(c100:IsMonster()) .. "/" .. pool:GetCount() .. "/" .. tostring(pool:IsContains(c100)) .. "/" .. tostring(pool:IsContains(c200)))
      Debug.Message("dynamic removed fusion selected " .. selected:GetCount())
      Debug.Message("dynamic removed fusion summon " .. Duel.FusionSummon(fusion,Group.FromCards(c100,c200)))
      `,
      "dynamic-removed-fusion-material.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("dynamic removed fusion pool false/1/false/true");
    expect(host.messages).toContain("dynamic removed fusion selected 0");
    expect(host.messages).toContain("dynamic removed fusion summon 0");
    expect(session.state.cards.find((card) => card.code === "300")).toMatchObject({ location: "extraDeck" });
  });
});

function setupDynamicSynchroFixture(seed: number): {
  session: DuelSession;
  reader: ReturnType<typeof createCardReader>;
  source: { readScript(name: string): string | undefined };
  synchroUid: string;
  tunerUid: string;
  nonTunerUid: string;
} {
  const cards: DuelCardData[] = [
    { code: "100", name: "Printed Non-Tuner", kind: "monster", typeFlags: 0x1, level: 3 },
    { code: "200", name: "Level 5 Non-Tuner", kind: "monster", typeFlags: 0x1, level: 5 },
    { code: "400", name: "Level 8 Synchro", kind: "extra", typeFlags: 0x2001, level: 8 },
  ];
  const reader = createCardReader(cards);
  const session = createDuel({ seed, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: ["100", "200"], extra: ["400"] }, 1: { main: [] } });
  startDuel(session);
  const tuner = requireCard(session, "100", "deck");
  const nonTuner = requireCard(session, "200", "deck");
  const synchro = requireCard(session, "400", "extraDeck");
  moveDuelCard(session.state, tuner.uid, "monsterZone", 0);
  moveDuelCard(session.state, nonTuner.uid, "monsterZone", 0);
  session.state.phase = "main1";
  session.state.waitingFor = 0;

  const source = { readScript: dynamicSynchroScript };
  const host = createLuaScriptHost(session, source);
  expect(host.loadCardScript(100, source).ok).toBe(true);
  expect(host.loadCardScript(400, source).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(2);
  expect(host.messages).toContain("dynamic material tuner true");

  return { session, reader, source, synchroUid: synchro.uid, tunerUid: tuner.uid, nonTunerUid: nonTuner.uid };
}

function requireCard(session: DuelSession, code: string, location: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code && candidate.location === location);
  expect(card).toBeDefined();
  return card!;
}

function dynamicSynchroScript(name: string): string | undefined {
  if (name === "c100.lua") {
    return `
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_SINGLE)
        e:SetCode(EFFECT_ADD_TYPE)
        e:SetValue(TYPE_TUNER)
        c:RegisterEffect(e)
        Debug.Message("dynamic material tuner " .. tostring(c:IsType(TYPE_TUNER)))
      end
    `;
  }
  if (name === "c400.lua") {
    return `
      c400={}
      function c400.initial_effect(c)
        Synchro.AddProcedure(c,nil,1,1,Synchro.NonTuner(nil),1,99)
      end
    `;
  }
  return undefined;
}

function dynamicMaterialPredicateScript(name: string): string | undefined {
  if (name !== "c100.lua") return undefined;
  return `
    c100={}
    function c100.initial_effect(c)
      local e0=Effect.CreateEffect(c)
      e0:SetType(EFFECT_TYPE_SINGLE)
      e0:SetCode(EFFECT_ADD_TYPE)
      e0:SetValue(TYPE_TUNER)
      c:RegisterEffect(e0)
      local e1=Effect.CreateEffect(c)
      e1:SetType(EFFECT_TYPE_SINGLE)
      e1:SetCode(EFFECT_CHANGE_RACE)
      e1:SetValue(RACE_SPELLCASTER)
      c:RegisterEffect(e1)
      local e2=Effect.CreateEffect(c)
      e2:SetType(EFFECT_TYPE_SINGLE)
      e2:SetCode(EFFECT_CHANGE_ATTRIBUTE)
      e2:SetValue(ATTRIBUTE_DARK)
      c:RegisterEffect(e2)
    end
  `;
}

function dynamicLinkMaterialTraitScript(name: string): string | undefined {
  if (name === "c100.lua") {
    return `
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_SINGLE)
        e:SetCode(EFFECT_ADD_LINK_CODE)
        e:SetValue(900)
        c:RegisterEffect(e)
      end
    `;
  }
  if (name === "c200.lua") {
    return `
      c200={}
      function c200.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_SINGLE)
        e:SetCode(EFFECT_ADD_LINK_SETCODE)
        e:SetValue(0x321)
        c:RegisterEffect(e)
      end
    `;
  }
  return undefined;
}

function dynamicGeneralMaterialTraitScript(name: string): string | undefined {
  if (name !== "c100.lua") return undefined;
  return `
    c100={}
    function c100.initial_effect(c)
      local e0=Effect.CreateEffect(c)
      e0:SetType(EFFECT_TYPE_SINGLE)
      e0:SetCode(EFFECT_ADD_CODE)
      e0:SetValue(900)
      c:RegisterEffect(e0)
      local e1=Effect.CreateEffect(c)
      e1:SetType(EFFECT_TYPE_SINGLE)
      e1:SetCode(EFFECT_ADD_TYPE)
      e1:SetValue(TYPE_TUNER)
      c:RegisterEffect(e1)
      local e2=Effect.CreateEffect(c)
      e2:SetType(EFFECT_TYPE_SINGLE)
      e2:SetCode(EFFECT_ADD_SETCODE)
      e2:SetValue(0x321)
      c:RegisterEffect(e2)
      Debug.Message("dynamic general material " .. tostring(c:IsCode(900)) .. "/" .. tostring(c:IsType(TYPE_TUNER)) .. "/" .. tostring(c:IsSetCard(0x321)) .. "/" .. tostring(c:IsOriginalCode(100)))
    end
  `;
}

function dynamicRemovedMonsterMaterialScript(name: string): string | undefined {
  if (name !== "c100.lua") return undefined;
  return `
    c100={}
    function c100.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_SINGLE)
      e:SetCode(EFFECT_REMOVE_TYPE)
      e:SetValue(TYPE_MONSTER)
      c:RegisterEffect(e)
    end
  `;
}
